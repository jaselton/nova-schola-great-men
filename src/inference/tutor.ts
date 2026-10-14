/**
 * The Tutor: one persistent voice over the Trivium engines, the developmental
 * modulator, and the Great Men library.
 *
 * This is a manual streaming loop over `client.beta.messages.stream` rather
 * than the SDK's tool runner, for three reasons: the conversation history is
 * owned here (it is serialized for stateless hosts such as a Netlify
 * function), cache breakpoints are placed deterministically each turn, and
 * the loop can be unit-tested with a scripted client. Tool inputs are
 * validated with the tool's own Zod schema before they run.
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadCorpus, REPO_ROOT } from "../corpus/index.js";
import type { Corpus } from "../corpus/types.js";
import { BANDS, bandForAge, type Band } from "./bands.js";
import { addUsage, emptyUsage, FALLBACK_BETA, resolveModel, type Effort, type ModelSpec, type UsageTotals } from "./models.js";
import { buildSystemPrompt, PROMPT_VERSION, studentContextBlock, type StudentContext } from "./prompt.js";
import { classifyMode, detectModeHeuristic, type ModeGuess } from "./router.js";
import { makeTutorTools, type TutorTool } from "./tools.js";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

export interface StudentProfile {
  name?: string;
  /** Student age; sets the developmental band unless `band` is given. */
  age?: number;
  band?: Band;
  subject?: string;
  topic?: string;
  strengths?: string[];
  challenges?: string[];
  /** Summary of earlier sessions (memory and continuity). */
  sessionSummary?: string;
  /** The person talking is a parent or teacher, not the student. */
  parentMode?: boolean;
}

export interface TutorOptions {
  client?: Anthropic;
  corpus?: Corpus;
  /** Repo root that holds profiles/ and research/ (defaults to this package). */
  root?: string;
  /** Model tier ("tutor", "fast", "frontier") or a raw model id. Default: tutor = Claude Opus 5.5. */
  model?: string;
  /** Overrides the band's default effort. */
  effort?: Effort;
  maxTokens?: number;
  /** Give the model the library tools (default true). */
  tools?: boolean;
  /** Use the server-side refusal fallback where the model supports it (default true). */
  fallbacks?: boolean;
  /** Maximum tool rounds per student turn before the tutor must answer (default 6). */
  maxToolRounds?: number;
  /** Return summarized thinking in the stream (default omitted). */
  thinkingDisplay?: "omitted" | "summarized";
  /** Also classify each turn's trivium mode with Claude Haiku 5.5 (default: heuristic only). */
  classifyModes?: boolean;
  /** Stable operator notes appended to the system prompt. */
  operatorNotes?: string;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  ok: boolean;
}

export interface TutorReply {
  text: string;
  mode: ModeGuess;
  stopReason: BetaMessage["stop_reason"];
  refused: boolean;
  /** The model that produced the final text (differs from the request model after a fallback). */
  servedBy: string;
  toolCalls: ToolCallRecord[];
  usage: UsageTotals;
}

export interface TurnRecord {
  student: string;
  tutor: string;
  mode: ModeGuess;
  toolCalls: ToolCallRecord[];
  servedBy: string;
}

/** Serializable session state for stateless hosts. */
export interface TutorState {
  version: 1;
  promptVersion: string;
  student: StudentProfile;
  band: Band;
  model: string;
  messages: BetaMessageParam[];
  turns: TurnRecord[];
  usage: UsageTotals;
}

export interface ReplyOptions {
  /** Receives text deltas as they stream. */
  onText?: (delta: string) => void;
  /** Receives summarized thinking deltas when thinkingDisplay is "summarized". */
  onThinking?: (delta: string) => void;
  signal?: AbortSignal;
}

const REFUSAL_TEXT = "I will not go further down that road with you. Let us return to the work: tell me what you were trying to understand, and we will take it from there.";

export class Tutor {
  readonly student: StudentProfile;
  readonly band: Band;
  readonly model: ModelSpec;
  readonly effort: Effort;
  readonly corpus: Corpus;
  readonly turns: TurnRecord[] = [];
  usage: UsageTotals = emptyUsage();
  messages: BetaMessageParam[] = [];

  private readonly client: Anthropic;
  private readonly tools: TutorTool[];
  private readonly system: Anthropic.Beta.Messages.BetaTextBlockParam[];
  private readonly options: TutorOptions;

  constructor(student: StudentProfile, options: TutorOptions = {}) {
    this.student = student;
    this.options = options;
    this.band = student.band ?? bandForAge(student.age ?? 12);
    this.model = resolveModel(options.model);
    this.effort = options.effort ?? BANDS[this.band].effort;
    this.corpus = options.corpus ?? loadCorpus(options.root ?? REPO_ROOT);
    this.client = options.client ?? new Anthropic();
    this.tools =
      options.tools === false
        ? []
        : makeTutorTools(this.corpus, { root: options.root ?? REPO_ROOT, defaultAgeRange: BANDS[this.band].lessonRange });
    this.system = buildSystemPrompt(this.corpus, this.band, {
      parentMode: student.parentMode,
      operatorNotes: options.operatorNotes,
    });
  }

  /** Rebuild a tutor from serialized state (same model, band and prompt version). */
  static fromState(state: TutorState, options: TutorOptions = {}): Tutor {
    const tutor = new Tutor({ ...state.student, band: state.band }, { ...options, model: options.model ?? state.model });
    tutor.messages = state.messages;
    tutor.turns.push(...state.turns);
    tutor.usage = { ...state.usage };
    return tutor;
  }

  toState(): TutorState {
    return {
      version: 1,
      promptVersion: PROMPT_VERSION,
      student: this.student,
      band: this.band,
      model: this.model.id,
      messages: this.messages,
      turns: this.turns,
      usage: this.usage,
    };
  }

  /** The request parameters shared by every call in this session (stable prefix). */
  private baseParams(): Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "messages" | "stream"> {
    const useFallback = this.options.fallbacks !== false && this.model.serverFallback;
    const thinking: Anthropic.Beta.Messages.BetaThinkingConfigParam =
      this.options.thinkingDisplay === "summarized" ? { type: "adaptive", display: "summarized" } : { type: "adaptive" };
    return {
      model: this.model.id,
      max_tokens: this.options.maxTokens ?? 16000,
      system: this.system,
      tools: this.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      thinking,
      output_config: { effort: this.effort },
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };
  }

  /** Keep exactly one message-level breakpoint: the last block of the newest user turn. */
  private placeCacheMarker(): void {
    for (const m of this.messages) {
      if (typeof m.content === "string") continue;
      for (const block of m.content) {
        if ("cache_control" in block) delete (block as { cache_control?: unknown }).cache_control;
      }
    }
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== "user") return;
    if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
    const block = last.content[last.content.length - 1];
    if (block && (block.type === "text" || block.type === "tool_result")) {
      (block as { cache_control?: { type: "ephemeral" } }).cache_control = { type: "ephemeral" };
    }
  }

  private async runTool(use: BetaToolUseBlock): Promise<{ result: BetaToolResultBlockParam; record: ToolCallRecord }> {
    const tool = this.tools.find((t) => t.name === use.name);
    if (!tool) {
      return {
        result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` },
        record: { name: use.name, input: use.input, ok: false },
      };
    }
    try {
      const input = tool.parse(use.input);
      const output = await tool.run(input as never);
      return {
        result: { type: "tool_result", tool_use_id: use.id, content: output },
        record: { name: use.name, input, ok: true },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Tool failed: ${message}` },
        record: { name: use.name, input: use.input, ok: false },
      };
    }
  }

  /** Send one student (or parent) turn and return the tutor's reply. */
  async reply(userText: string, options: ReplyOptions = {}): Promise<TutorReply> {
    const ctx: StudentContext = { ...this.student, band: this.band };
    const content: BetaContentBlockParam[] = [];
    if (this.messages.length === 0) content.push({ type: "text", text: studentContextBlock(ctx) });
    content.push({ type: "text", text: userText });
    this.messages.push({ role: "user", content });

    const modePromise = this.options.classifyModes
      ? classifyMode(userText, { client: this.client, priorTurns: this.turns.map((t) => t.student) }).catch(() => detectModeHeuristic(userText))
      : Promise.resolve(detectModeHeuristic(userText));

    const turnUsage = emptyUsage();
    const toolCalls: ToolCallRecord[] = [];
    const maxRounds = this.options.maxToolRounds ?? 6;
    let final: BetaMessage | undefined;
    let text = "";

    for (let round = 0; ; round++) {
      this.placeCacheMarker();
      const stream = this.client.beta.messages.stream({ ...this.baseParams(), messages: this.messages }, { signal: options.signal });
      let roundText = "";
      stream.on("text", (delta) => {
        roundText += delta;
        options.onText?.(delta);
      });
      if (options.onThinking) stream.on("thinking", (delta) => options.onThinking?.(delta));
      final = await stream.finalMessage();
      addUsage(turnUsage, final.usage);
      addUsage(this.usage, final.usage);
      // Pass the whole assistant turn back (thinking blocks included) so preserved thinking stays valid.
      this.messages.push({ role: "assistant", content: final.content });
      if (roundText) text = roundText;

      if (final.stop_reason === "pause_turn") continue;
      if (final.stop_reason !== "tool_use") break;

      const uses = final.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) break;
      const results: BetaToolResultBlockParam[] = [];
      if (round >= maxRounds) {
        for (const u of uses) {
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Tool budget for this turn is spent. Answer the student with what you have." });
          toolCalls.push({ name: u.name, input: u.input, ok: false });
        }
      } else {
        const ran = await Promise.all(uses.map((u) => this.runTool(u)));
        for (const r of ran) {
          results.push(r.result);
          toolCalls.push(r.record);
        }
      }
      // All results for a parallel tool call go back in one user message.
      this.messages.push({ role: "user", content: results });
    }

    const message = final!;
    const refused = message.stop_reason === "refusal";
    if (refused) {
      text = REFUSAL_TEXT;
      options.onText?.(text);
    } else if (!text) {
      text = message.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    }
    const mode = await modePromise;
    const servedBy = message.model;
    this.turns.push({ student: userText, tutor: text, mode, toolCalls, servedBy });
    return { text, mode, stopReason: message.stop_reason, refused, servedBy, toolCalls, usage: turnUsage };
  }
}
