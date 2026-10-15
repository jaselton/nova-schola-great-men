/**
 * Trivium mode detection - which internal engine a student turn calls for.
 *
 * The tutor model selects its own mode (the system prompt tells it how); this
 * router exists so the application can log the mode per turn, balance the
 * trivium over time, and score evals. Heuristics are free; the classifier
 * costs a Haiku call.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODELS } from "./models.js";

export type TriviumMode = "grammar" | "logic" | "rhetoric";

export const TRIVIUM_MODES: readonly TriviumMode[] = ["grammar", "logic", "rhetoric"];

interface Rule {
  mode: TriviumMode;
  pattern: RegExp;
}

/** Ordered rules from the System Prompt v2 "Mode Detection Heuristics" table, extended. */
const RULES: Rule[] = [
  { mode: "rhetoric", pattern: /\b(how (do|should|can) i (write|say|explain|argue|present|tell)|essay|paragraph|speech|debate|persuade|convince|sounds? boring|rewrite|thesis|introduction|conclusion)\b/i },
  { mode: "rhetoric", pattern: /\b(what should i do|is (it|that|this) (right|wrong|fair)|was (\w+ )?(right|wrong|justified)|should (\w+ )?have|right to\b|wrong to\b|judge|unfair|moral|ethic)/i },
  { mode: "logic", pattern: /\b(why|how (does|did|do|come)|prove|proof|because|explain why|does (it|this|that) (work|follow)|what if|cause|reason|logic|argument|fallacy|contradict)\b/i },
  { mode: "logic", pattern: /\b(i (got|have) the answer but|not sure why|doesn'?t make sense|confus)/i },
  { mode: "grammar", pattern: /\b(who (was|is|were)|what (is|was|are|were|does .* mean)|define|definition|when (did|was)|where (did|was)|tell me about|list|name the|how many|what year|vocabulary|spell)\b/i },
];

export interface ModeGuess {
  mode: TriviumMode;
  confidence: number;
  reason: string;
}

/** Cheap, deterministic guess. Falls back to Grammar (verify, then build) when nothing matches. */
export function detectModeHeuristic(text: string): ModeGuess {
  const t = text.trim();
  for (const rule of RULES) {
    const m = rule.pattern.exec(t);
    if (m) return { mode: rule.mode, confidence: 0.6, reason: `matched "${m[0]}"` };
  }
  if (t.endsWith("?")) return { mode: "grammar", confidence: 0.35, reason: "question with no reasoning marker" };
  return { mode: "grammar", confidence: 0.3, reason: "no signal; default to knowledge first" };
}

const ModeSchema = z.object({
  mode: z.enum(["grammar", "logic", "rhetoric"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

const CLASSIFIER_SYSTEM = `You classify a student's message to a classical tutor into one of three trivium modes.
grammar: the student needs facts, definitions, vocabulary, a timeline, a story, or memory help. "What is?"
logic: the student needs reasoning, cause and effect, proof, argument evaluation, or help understanding why something works. "Is it true?"
rhetoric: the student needs help expressing, writing, speaking, persuading, synthesizing, or making a moral judgment. "How should it be said, and to whom?"
Pick the mode the tutor should lead with. Factual errors start in grammar; reasoning errors start in logic; expression struggles start in rhetoric.`;

/**
 * Classify with Claude Haiku 5.5 and structured output. One short request,
 * low effort. Use when the heuristic confidence is low or for eval scoring.
 */
export async function classifyMode(
  text: string,
  options: { client?: Anthropic; model?: string; priorTurns?: string[] } = {},
): Promise<ModeGuess> {
  const client = options.client ?? new Anthropic();
  const context = options.priorTurns?.length
    ? `Earlier student turns, oldest first:\n${options.priorTurns.map((t) => `- ${t}`).join("\n")}\n\n`
    : "";
  const response = await client.messages.parse({
    model: options.model ?? MODELS.classifier.id,
    max_tokens: 512,
    system: CLASSIFIER_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ModeSchema) },
    messages: [{ role: "user", content: `${context}Student message:\n${text}` }],
  });
  const parsed = response.parsed_output;
  if (!parsed) return detectModeHeuristic(text);
  return parsed;
}
