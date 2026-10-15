/**
 * Model registry for the Nova Schola tutor.
 *
 * Four tiers, all Claude 5 family (October 2026). The tutor runs on Opus 5.5
 * by default; the other tiers are opt-in by name. IDs are the exact strings
 * the Claude API accepts - never append date suffixes.
 */

export type ModelTier = "tutor" | "fast" | "classifier" | "frontier" | "codex";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelSpec {
  tier: ModelTier;
  id: string;
  label: string;
  /** USD per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** Effort the API applies when `output_config.effort` is omitted. */
  apiDefaultEffort: Effort;
  /** Whether the server-side `fallbacks: "default"` safeguard is available. */
  serverFallback: boolean;
  role: string;
}

export const MODELS: Record<ModelTier, ModelSpec> = {
  tutor: {
    tier: "tutor",
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    apiDefaultEffort: "medium",
    serverFallback: true,
    role: "Default tutor. Carries the persona, the Socratic turn-taking and the Great Men exempla.",
  },
  fast: {
    tier: "fast",
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    apiDefaultEffort: "high",
    serverFallback: true,
    role: "Lower-latency tutor tier for high-volume chat once the Opus prompt has been evaluated.",
  },
  classifier: {
    tier: "classifier",
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    apiDefaultEffort: "medium",
    serverFallback: false,
    role: "Trivium-mode classification, eval judging and other small structured tasks.",
  },
  codex: {
    tier: "codex",
    id: "gpt-6-astra",
    label: "OpenAI Codex (gpt-6-astra)",
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheReadPerMTok: 0,
    apiDefaultEffort: "medium",
    serverFallback: false,
    role: "Runs the tutor through the local Codex CLI with its own login; the library is served over MCP. Billed by the ChatGPT plan, not per token.",
  },
  frontier: {
    tier: "frontier",
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 0.25,
    apiDefaultEffort: "high",
    serverFallback: true,
    role: "Opt-in for drafting new research essays and profiles where depth matters more than cost.",
  },
};

/** Beta header for the scalar `fallbacks: "default"` form. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

/** Resolve a tier name ("tutor", "fast", ...) or a raw model id to a spec. */
export function resolveModel(ref?: string): ModelSpec {
  if (!ref) return MODELS.tutor;
  const tier = (Object.keys(MODELS) as ModelTier[]).find((t) => t === ref);
  if (tier) return MODELS[tier];
  const byId = Object.values(MODELS).find((m) => m.id === ref);
  if (byId) return byId;
  // Unknown id: trust the caller, but assume no server fallback.
  return {
    tier: "tutor",
    id: ref,
    label: ref,
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheReadPerMTok: 0,
    apiDefaultEffort: "high",
    serverFallback: false,
    role: "Custom model id.",
  };
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0 };
}

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function addUsage(totals: UsageTotals, usage: UsageLike): UsageTotals {
  totals.inputTokens += usage.input_tokens;
  totals.outputTokens += usage.output_tokens;
  totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  totals.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
  totals.requests += 1;
  return totals;
}

/** Rough USD cost; cache writes are billed at 1.25x input. */
export function estimateCost(totals: UsageTotals, spec: ModelSpec): number {
  const perTok = (perM: number) => perM / 1_000_000;
  return (
    totals.inputTokens * perTok(spec.inputPerMTok) +
    totals.cacheWriteTokens * perTok(spec.inputPerMTok) * 1.25 +
    totals.cacheReadTokens * perTok(spec.cacheReadPerMTok) +
    totals.outputTokens * perTok(spec.outputPerMTok)
  );
}
