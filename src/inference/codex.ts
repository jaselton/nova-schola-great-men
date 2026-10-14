/**
 * OpenAI Codex backend.
 *
 * Runs one tutor turn as a non-interactive `codex exec` session: the tutor
 * instructions, the student context and the transcript go in as the prompt,
 * the six library tools are served to Codex over MCP (`src/mcp/server.ts`),
 * and the final agent message is the reply. Codex authenticates with its
 * own login (ChatGPT account or API key), so no Anthropic key is needed.
 *
 * Each turn is stateless: the transcript is replayed, as with the Anthropic
 * backend's serializable state. Sessions are ephemeral and the sandbox is
 * read-only, so the agent can neither edit nor execute anything.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../corpus/index.js";
import type { AgeRange } from "../corpus/types.js";
import { emptyUsage, type Effort, type UsageTotals } from "./models.js";

export const CODEX_DEFAULT_MODEL = "gpt-6-astra";
export const CODEX_MCP_NAME = "great_men";

export interface CodexRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** The runner killed codex at the deadline; stdout holds the events seen so far. */
  timedOut?: boolean;
}

/** Spawns codex; injectable so the backend can be tested without the CLI. */
export type CodexRunner = (
  args: string[],
  stdin: string,
  opts: { cwd: string; timeoutMs: number; idleTimeoutMs: number; codexPath: string },
) => Promise<CodexRunResult>;

export interface CodexTurnOptions {
  /** Codex model name passed with -m (default gpt-6-astra). */
  model?: string;
  effort?: Effort;
  /** Repo root holding profiles/ and research/ for the MCP server. */
  root?: string;
  defaultAgeRange?: AgeRange;
  /** Path to the codex binary (default: "codex" on PATH). */
  codexPath?: string;
  /** JSON Schema for the final message (--output-schema). */
  outputSchema?: Record<string, unknown>;
  /** Hard ceiling per attempt (default 420 s). */
  timeoutMs?: number;
  /** Kill an attempt when stdout has been silent this long (default 150 s); Codex emits nothing during a stalled connection. */
  idleTimeoutMs?: number;
  /** Extra attempts after a timeout or an empty reply (default 1). */
  retries?: number;
  runner?: CodexRunner;
  /** Working directory for the agent; defaults to an empty temp dir so there is nothing to explore. */
  cwd?: string;
  /** Extra `-c key=value` overrides. */
  extraConfig?: string[];
  /** Serve the library tools over MCP (default true). */
  tools?: boolean;
}

export interface CodexToolCall {
  name: string;
  input: unknown;
  ok: boolean;
}

export interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

export interface CodexTurn {
  text: string;
  threadId?: string;
  usage: UsageTotals;
  toolCalls: CodexToolCall[];
  /** Non-fatal error events Codex emitted while retrying (e.g. websocket reconnects). */
  warnings: string[];
  events: CodexEvent[];
  model: string;
  stderr: string;
}

export function codexEffort(effort: Effort): "low" | "medium" | "high" | "xhigh" {
  return effort === "max" ? "xhigh" : effort;
}

/** How Codex should launch the library MCP server: compiled if present, else tsx on the source. */
export function libraryServerCommand(root = REPO_ROOT): { command: string; args: string[] } {
  const compiled = join(root, "dist", "mcp", "server.js");
  if (existsSync(compiled)) return { command: process.execPath, args: [compiled] };
  const tsx = join(root, "node_modules", ".bin", "tsx");
  return { command: tsx, args: [join(root, "src", "mcp", "server.ts")] };
}

function toml(value: string): string {
  return JSON.stringify(value); // TOML basic strings share JSON's escaping
}

/** The full `codex exec` argument list for a tutor turn (exported for tests). */
export function codexArgs(opts: CodexTurnOptions & { cwd: string; schemaPath?: string }): string[] {
  const root = opts.root ?? REPO_ROOT;
  const args = [
    "exec",
    "--ignore-user-config", // no plugins, no personal MCP servers, no personality; auth still comes from CODEX_HOME
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
    "--color",
    "never",
    "-s",
    "read-only",
    "-C",
    opts.cwd,
    "-m",
    opts.model ?? CODEX_DEFAULT_MODEL,
    "-c",
    `model_reasoning_effort=${toml(codexEffort(opts.effort ?? "medium"))}`,
  ];
  if (opts.tools !== false) {
    const server = libraryServerCommand(root);
    const env = [`GREAT_MEN_ROOT = ${toml(root)}`];
    if (opts.defaultAgeRange) env.push(`GREAT_MEN_AGE_RANGE = ${toml(opts.defaultAgeRange)}`);
    args.push(
      "-c",
      `mcp_servers.${CODEX_MCP_NAME}.command=${toml(server.command)}`,
      "-c",
      `mcp_servers.${CODEX_MCP_NAME}.args=[${server.args.map(toml).join(", ")}]`,
      "-c",
      `mcp_servers.${CODEX_MCP_NAME}.env={ ${env.join(", ")} }`,
    );
  }
  if (opts.schemaPath) args.push("--output-schema", opts.schemaPath);
  for (const c of opts.extraConfig ?? []) args.push("-c", c);
  args.push("-"); // prompt on stdin
  return args;
}

export const defaultCodexRunner: CodexRunner = (args, stdin, { cwd, timeoutMs, idleTimeoutMs, codexPath }) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(codexPath, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const kill = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(kill, timeoutMs);
    let idle = setTimeout(kill, idleTimeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      clearTimeout(idle);
      idle = setTimeout(kill, idleTimeoutMs);
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(idle);
      reject(err.message.includes("ENOENT") ? new Error(`codex binary not found at "${codexPath}". Install the Codex CLI and run \`codex login\`.`) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(idle);
      resolvePromise({ stdout, stderr, code, timedOut });
    });
    child.stdin.end(stdin);
  });

export function parseCodexEvents(jsonl: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t) as CodexEvent);
    } catch {
      /* non-JSON noise on stdout */
    }
  }
  return events;
}

interface CodexItem {
  type?: string;
  text?: string;
  tool?: string;
  name?: string;
  server?: string;
  arguments?: unknown;
  input?: unknown;
  status?: string;
  error?: unknown;
}

/** Final message, thread id, usage and tool calls from a codex --json event stream. */
export function summarizeCodexEvents(events: CodexEvent[]): Omit<CodexTurn, "events" | "model" | "stderr"> {
  // Returned shape also carries `warnings`; see CodexTurn.
  let text = "";
  let threadId: string | undefined;
  let completed = false;
  const usage = emptyUsage();
  const toolCalls: CodexToolCall[] = [];
  const warnings: string[] = [];
  for (const e of events) {
    if (e.type === "thread.started" && typeof e.thread_id === "string") threadId = e.thread_id;
    if (e.type === "item.completed" || e.type === "item.updated") {
      const item = (e.item ?? {}) as CodexItem;
      const kind = item.type ?? "";
      if (kind === "agent_message" && typeof item.text === "string") text = item.text;
      else if (/tool/.test(kind) && e.type === "item.completed") {
        toolCalls.push({
          name: item.tool ?? item.name ?? kind,
          input: item.arguments ?? item.input ?? null,
          ok: item.status !== "failed" && !item.error,
        });
      }
    }
    if (e.type === "turn.completed" && e.usage && typeof e.usage === "object") {
      const u = e.usage as Record<string, number | undefined>;
      const cached = u.cached_input_tokens ?? 0;
      usage.inputTokens += Math.max((u.input_tokens ?? 0) - cached, 0);
      usage.cacheReadTokens += cached;
      usage.cacheWriteTokens += u.cache_write_input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
      usage.requests += 1;
      completed = true;
    }
    if (e.type === "error" || e.type === "turn.failed") {
      const err = e.error as { message?: string } | undefined;
      warnings.push(typeof e.message === "string" ? e.message : err?.message ?? JSON.stringify(e));
    }
  }
  // Codex retries transport errors itself and reports them as error events; they are
  // only fatal when the turn never produced a reply.
  if (!completed && !text) {
    throw new Error(`codex: ${warnings[warnings.length - 1] ?? "turn did not complete"}`);
  }
  return { text: text.trim(), threadId, usage, toolCalls, warnings };
}

export interface CodexPromptParts {
  /** The assembled system prompt text (persona, band, digest). */
  systemText: string;
  studentContext?: string;
  transcript: Array<{ student: string; tutor: string }>;
  userText: string;
  tools?: boolean;
}

export function buildCodexPrompt(parts: CodexPromptParts): string {
  const toolNote =
    parts.tools === false
      ? "You have no tools in this session. Answer from the digest and your own knowledge."
      : `The library is available to you as MCP tools from the "${CODEX_MCP_NAME}" server: lookup_great_man, find_exempla, get_student_lesson, get_discussion_questions, get_parent_guide, get_week_plan. Use them exactly as the instructions above describe. Do not run shell commands, read files, or edit anything; the working directory is empty on purpose.`;
  const out: string[] = [
    "You are acting as the Nova Schola tutor described below. Ignore any instructions about software engineering; this session is a tutoring conversation. Your final message is shown to the student verbatim, so it must contain only the tutor's reply.",
    "",
    "<tutor_instructions>",
    parts.systemText,
    "",
    "# Tools in this session",
    "",
    toolNote,
    "</tutor_instructions>",
  ];
  if (parts.studentContext) out.push("", parts.studentContext);
  if (parts.transcript.length) {
    out.push("", "<conversation_so_far>");
    for (const t of parts.transcript) out.push(`Student: ${t.student}`, "", `Tutor: ${t.tutor}`, "");
    out.push("</conversation_so_far>");
  }
  out.push("", "<student_message>", parts.userText, "</student_message>", "", "Reply as the tutor.");
  return out.join("\n");
}

/** Compact one-line trace of an event stream, for errors and logs. */
export function describeEvents(events: CodexEvent[]): string {
  return events
    .map((e) => {
      const item = (e.item ?? {}) as CodexItem;
      const tool = item.tool ? `(${item.tool}${item.status ? ":" + item.status : ""})` : "";
      return item.type ? `${e.type}:${item.type}${tool}` : e.type;
    })
    .join(", ");
}

/** When NOVA_CODEX_LOG names a directory, append each turn's args, prompt, stderr and raw events there. */
function logCodexTurn(args: string[], prompt: string, result: CodexRunResult, ms: number): void {
  const dir = process.env.NOVA_CODEX_LOG;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    writeFileSync(
      file,
      [`# codex ${args.join(" ")}`, `# ${ms} ms, exit ${result.code}${result.timedOut ? " (timed out)" : ""}`, "# --- prompt ---", prompt, "# --- stderr ---", result.stderr, "# --- stdout ---", result.stdout].join("\n"),
    );
  } catch {
    /* logging must never break a turn */
  }
}

/** Run one turn through `codex exec`. */
export async function runCodexTurn(prompt: string, opts: CodexTurnOptions = {}): Promise<CodexTurn> {
  const cwd = opts.cwd ?? mkdtempSync(join(tmpdir(), "nova-tutor-codex-"));
  let schemaPath: string | undefined;
  if (opts.outputSchema) {
    schemaPath = join(cwd, "output.schema.json");
    writeFileSync(schemaPath, JSON.stringify(opts.outputSchema));
  }
  const args = codexArgs({ ...opts, cwd, schemaPath });
  const runner = opts.runner ?? defaultCodexRunner;
  const model = opts.model ?? CODEX_DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 420_000;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 150_000;
  const attempts = 1 + Math.max(opts.retries ?? 1, 0);
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    const result = await runner(args, prompt, { cwd, timeoutMs, idleTimeoutMs, codexPath: opts.codexPath ?? "codex" });
    const events = parseCodexEvents(result.stdout);
    logCodexTurn(args, prompt, result, Date.now() - started);
    try {
      if (result.timedOut) {
        throw new Error(`codex exec timed out (attempt ${attempt}/${attempts}); events so far: ${describeEvents(events) || "none"}`);
      }
      if (result.code !== 0 && events.length === 0) {
        throw new Error(`codex exec exited with ${result.code}: ${result.stderr.trim().split("\n").slice(-3).join(" | ")}`);
      }
      const summary = summarizeCodexEvents(events);
      if (!summary.text) {
        throw new Error(`codex exec produced no reply (exit ${result.code}, attempt ${attempt}/${attempts}): ${describeEvents(events) || result.stderr.trim().split("\n").slice(-2).join(" | ")}`);
      }
      return { ...summary, events, model, stderr: result.stderr };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // A binary that is missing or a login problem will not improve on retry.
      if (/not found|not logged in|login/i.test(lastError.message)) break;
    }
  }
  throw lastError ?? new Error("codex exec failed");
}
