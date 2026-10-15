/**
 * Runtime-agnostic HTTP handler for the tutor: the same code serves the
 * Netlify Function and the Cloudflare Worker route. Everything environment-
 * specific (API key, corpus data, file reads) is injected.
 *
 * Contracts
 *   { "message": "...", "student": { "age": 12, "name": "Ada", "parentMode": false } }   first turn
 *   { "message": "...", "state": <state from the previous response> }                     later turns
 *   { "messages": [{ "role": "user"|"assistant", "content": "..." }, ...] }                 legacy /demo page
 * Response
 *   { message, reply, mode, servedBy, refused, usage, state, stateSig? }
 * With `stateKey` set, `stateSig` must be echoed back alongside `state` on the next turn.
 *
 * Caps per request: message length (2000 chars), turns per conversation (40), body size (200 KB),
 * serialized state (150 KB), tokens generated per model call (4000), tool rounds per turn (4).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Corpus } from "../corpus/types.js";
import { bandForAge } from "../inference/bands.js";
import { studentContextBlock } from "../inference/prompt.js";
import type { CorpusFileReader } from "../inference/tools.js";
import { Tutor, type StudentProfile, type TutorState } from "../inference/tutor.js";

export interface HandlerEnv {
  /** Anthropic API key; the handler answers 503 without one. */
  apiKey?: string;
  /** The parsed corpus (data/great-men.json). */
  corpus: Corpus;
  /** Reads a repo-relative markdown file (profiles/..., research/..., framework/...). */
  readFile: CorpusFileReader;
  /** Tier name or model id (default "tutor" = Claude Opus 5.5). */
  model?: string;
  /** Allowed CORS origins; empty = any. */
  allowedOrigins?: string[];
  maxMessageChars?: number;
  maxTurns?: number;
  maxToolRounds?: number;
  /** Cap on tokens generated per model call (default 4000; replies are a few sentences). */
  maxTokens?: number;
  /** Cap on the serialized session state a client may send back (default 150000 chars; input tokens are cost too). */
  maxStateChars?: number;
  /**
   * Secret used to sign the session state (HMAC-SHA256). When set, responses carry `stateSig` and a
   * request with `state` must return the matching `stateSig`, so a client cannot fabricate history.
   */
  stateKey?: string;
  /** Injected for tests. */
  client?: Anthropic;
}

interface LegacyMessage {
  role: "user" | "assistant";
  content: string;
}

interface TutorRequest {
  message?: string;
  student?: StudentProfile;
  state?: TutorState;
  stateSig?: string;
  messages?: LegacyMessage[];
}

export const DEFAULT_MAX_MESSAGE_CHARS = 2000;
export const DEFAULT_MAX_TURNS = 40;
export const DEFAULT_MAX_STATE_CHARS = 150_000;

const encoder = new TextEncoder();

/** WebCrypto key type without depending on the DOM lib (the handler runs on Node and on Workers). */
type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

async function hmacKey(secret: string): Promise<HmacKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Canonical serialization of the state used for signing; the same string is what the client echoes back. */
export function serializeState(state: TutorState): string {
  return JSON.stringify(state);
}

/** HMAC-SHA256 of the serialized state, hex. Works on Node 20+ and Workers (WebCrypto). */
export async function signState(serialized: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(serialized));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyState(serialized: string, signature: string, secret: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const bytes = new Uint8Array(signature.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, encoder.encode(serialized));
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const allow = allowed.length === 0 ? "*" : origin && allowed.includes(origin) ? origin : allowed[0]!;
  return { "access-control-allow-origin": allow, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

export function cleanStudent(input: StudentProfile | undefined): StudentProfile {
  const s = input ?? {};
  const age = typeof s.age === "number" && Number.isFinite(s.age) ? Math.min(Math.max(Math.round(s.age), 5), 99) : 12;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n<>]/g, " ").trim().slice(0, max) : undefined) || undefined;
  return { age, name: text(s.name, 40), subject: text(s.subject, 60), topic: text(s.topic, 80), parentMode: s.parentMode === true };
}

/** Rebuild tutor state from the original demo page's {messages} history. */
export function stateFromLegacy(messages: LegacyMessage[], modelId: string): { state: TutorState; message: string } {
  const clean = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  const last = clean[clean.length - 1];
  if (!last || last.role !== "user") throw new Error("messages must end with a user message");
  const history = clean.slice(0, -1);
  const student = cleanStudent({ age: 12 });
  const band = bandForAge(student.age!);
  const turns: { student: string; tutor: string }[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    const next = history[i + 1];
    if (m.role === "user" && next?.role === "assistant") turns.push({ student: m.content, tutor: next.content });
  }
  const state: TutorState = {
    version: 1,
    promptVersion: "legacy",
    student,
    band,
    model: modelId,
    backend: "anthropic",
    messages: turns.flatMap((t, i) => [
      {
        role: "user" as const,
        content: i === 0 ? [{ type: "text" as const, text: studentContextBlock({ ...student, band }) }, { type: "text" as const, text: t.student }] : t.student,
      },
      { role: "assistant" as const, content: t.tutor },
    ]),
    turns: turns.map((t) => ({ ...t, mode: { mode: "grammar" as const, confidence: 0, reason: "legacy history" }, toolCalls: [], servedBy: "legacy" })),
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0 },
  };
  return { state, message: last.content };
}

/** Handle one HTTP request. Works with the Fetch API Request/Response on Node 18+, Netlify and Workers. */
export async function handleTutorRequest(req: Request, env: HandlerEnv): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, env.allowedOrigins ?? []);
  const json = (body: unknown, status: number) => jsonResponse(body, status, cors);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!env.apiKey && !env.client) return json({ error: "The tutor is not configured on this deployment." }, 503);

  const maxChars = env.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
  const maxTurns = env.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxStateChars = env.maxStateChars ?? DEFAULT_MAX_STATE_CHARS;

  let body: TutorRequest;
  try {
    const raw = await req.text();
    if (raw.length > 200_000) return json({ error: "Request too large" }, 413);
    body = JSON.parse(raw) as TutorRequest;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const client = env.client ?? new Anthropic({ apiKey: env.apiKey });
  const options = { client, corpus: env.corpus, readFile: env.readFile, model: env.model ?? "tutor", maxToolRounds: env.maxToolRounds ?? 4, maxTokens: env.maxTokens ?? 4000 };

  let tutor: Tutor;
  let message: string;
  try {
    if (Array.isArray(body.messages)) {
      const legacy = stateFromLegacy(body.messages.slice(-2 * maxTurns), new Tutor({ age: 12 }, { ...options, tools: false }).model.id);
      tutor = Tutor.fromState(legacy.state, options);
      message = legacy.message;
    } else {
      message = typeof body.message === "string" ? body.message.trim() : "";
      if (body.state && body.state.version === 1 && Array.isArray(body.state.messages) && Array.isArray(body.state.turns)) {
        if (body.state.turns.length >= maxTurns) return json({ error: "This conversation has reached its length. Start a new one." }, 400);
        const serialized = serializeState(body.state);
        if (serialized.length > maxStateChars) return json({ error: "This conversation has grown too long. Start a new one." }, 413);
        if (env.stateKey) {
          const ok = typeof body.stateSig === "string" && (await verifyState(serialized, body.stateSig, env.stateKey));
          if (!ok) return json({ error: "The conversation state was not recognized. Start a new one." }, 400);
        }
        tutor = Tutor.fromState({ ...body.state, student: cleanStudent(body.state.student) }, options);
      } else {
        tutor = new Tutor(cleanStudent(body.student), options);
      }
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "bad request" }, 400);
  }
  if (!message) return json({ error: "message is required" }, 400);
  if (message.length > maxChars) return json({ error: `Keep messages under ${maxChars} characters.` }, 413);

  try {
    const reply = await tutor.reply(message);
    const state = tutor.toState();
    const stateSig = env.stateKey ? await signState(serializeState(state), env.stateKey) : undefined;
    return json(
      { message: reply.text, reply: reply.text, mode: reply.mode.mode, servedBy: reply.servedBy, refused: reply.refused, usage: reply.usage, state, stateSig },
      200,
    );
  } catch (err) {
    console.error("tutor error", err instanceof Error ? err.message : err);
    return json({ error: "I am momentarily unable to respond. Please try again in a moment." }, 502);
  }
}
