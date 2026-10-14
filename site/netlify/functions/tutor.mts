/**
 * POST /api/tutor  (also served at /.netlify/functions/tutor)
 *
 * New contract (site/public/index.html):
 *   { "message": "Who was Alexander?", "student": { "age": 12, "name": "Ada", "parentMode": false } }
 *   { "message": "And then?", "state": <state from the previous response> }
 * Legacy contract (the original /demo page):
 *   { "messages": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }, ...] }
 *
 * Response: { message, reply, mode, servedBy, refused, usage, state }
 * `message` keeps the legacy page working; `state` is what the new page sends back.
 *
 * Stateless: nothing is stored server-side. Needs ANTHROPIC_API_KEY in the site environment.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Tutor, bandForAge, studentContextBlock, type StudentProfile, type TutorState } from "../../../src/index.js";

const MAX_MESSAGE_CHARS = 2000;
const MAX_TURNS = 40;
const MODEL = process.env.NOVA_TUTOR_MODEL || "tutor"; // tier name or model id
const ALLOWED_ORIGINS = (process.env.NOVA_TUTOR_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Locate the bundled corpus: included_files keep their repo-relative paths, but where the zip is mounted varies. */
function corpusRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), here, ...[1, 2, 3, 4, 5].map((n) => resolve(here, ...Array(n).fill(".."))), "/var/task"];
  for (const c of candidates) if (existsSync(join(c, "data", "great-men.json"))) return c;
  throw new Error("corpus not found in the function bundle; check included_files in netlify.toml");
}

interface LegacyMessage {
  role: "user" | "assistant";
  content: string;
}

interface TutorRequest {
  message?: string;
  student?: StudentProfile;
  state?: TutorState;
  messages?: LegacyMessage[];
}

const corsHeaders = (origin: string | null) => {
  const allow = ALLOWED_ORIGINS.length === 0 ? "*" : origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!;
  return { "access-control-allow-origin": allow, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
};

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(origin) } });

function cleanStudent(input: StudentProfile | undefined): StudentProfile {
  const s = input ?? {};
  const age = typeof s.age === "number" && Number.isFinite(s.age) ? Math.min(Math.max(Math.round(s.age), 5), 99) : 12;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n<>]/g, " ").trim().slice(0, max) : undefined) || undefined;
  return {
    age,
    name: text(s.name, 40),
    subject: text(s.subject, 60),
    topic: text(s.topic, 80),
    parentMode: s.parentMode === true,
  };
}

/** Turn the original demo's {messages} history into tutor state so the old page keeps working. */
function stateFromLegacy(messages: LegacyMessage[], root: string): { tutor: Tutor; message: string } {
  const clean = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  const last = clean[clean.length - 1];
  if (!last || last.role !== "user") throw new Error("messages must end with a user message");
  const history = clean.slice(0, -1);
  const student = cleanStudent({ age: 12 });
  const band = bandForAge(student.age!);
  const tutor = new Tutor(student, { model: MODEL, root, maxToolRounds: 4 });
  const turns: { student: string; tutor: string }[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    if (m.role === "user") {
      const next = history[i + 1];
      if (next?.role === "assistant") turns.push({ student: m.content, tutor: next.content });
    }
  }
  const state: TutorState = {
    version: 1,
    promptVersion: "legacy",
    student,
    band,
    model: tutor.model.id,
    backend: "anthropic",
    messages: turns.flatMap((t, i) => [
      { role: "user" as const, content: i === 0 ? [{ type: "text" as const, text: studentContextBlock({ ...student, band }) }, { type: "text" as const, text: t.student }] : t.student },
      { role: "assistant" as const, content: t.tutor },
    ]),
    turns: turns.map((t) => ({ ...t, mode: { mode: "grammar" as const, confidence: 0, reason: "legacy history" }, toolCalls: [], servedBy: "legacy" })),
    usage: tutor.usage,
  };
  return { tutor: Tutor.fromState(state, { model: MODEL, root, maxToolRounds: 4 }), message: last.content };
}

export default async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "The tutor is not configured on this deployment." }, 503, origin);

  let body: TutorRequest;
  try {
    const raw = await req.text();
    if (raw.length > 200_000) return json({ error: "Request too large" }, 413, origin);
    body = JSON.parse(raw) as TutorRequest;
  } catch {
    return json({ error: "Body must be JSON" }, 400, origin);
  }

  let root: string;
  try {
    root = corpusRoot();
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "corpus missing" }, 500, origin);
  }

  let tutor: Tutor;
  let message: string;
  try {
    if (Array.isArray(body.messages)) {
      ({ tutor, message } = stateFromLegacy(body.messages.slice(-2 * MAX_TURNS), root));
    } else {
      message = typeof body.message === "string" ? body.message.trim() : "";
      if (body.state && body.state.version === 1 && Array.isArray(body.state.messages)) {
        if (body.state.turns.length >= MAX_TURNS) return json({ error: "This conversation has reached its length. Start a new one." }, 400, origin);
        tutor = Tutor.fromState({ ...body.state, student: cleanStudent(body.state.student) }, { model: MODEL, root, maxToolRounds: 4 });
      } else {
        tutor = new Tutor(cleanStudent(body.student), { model: MODEL, root, maxToolRounds: 4 });
      }
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "bad request" }, 400, origin);
  }
  if (!message) return json({ error: "message is required" }, 400, origin);
  if (message.length > MAX_MESSAGE_CHARS) return json({ error: `Keep messages under ${MAX_MESSAGE_CHARS} characters.` }, 413, origin);

  try {
    const reply = await tutor.reply(message);
    return json(
      {
        message: reply.text,
        reply: reply.text,
        mode: reply.mode.mode,
        servedBy: reply.servedBy,
        refused: reply.refused,
        usage: reply.usage,
        state: tutor.toState(),
      },
      200,
      origin,
    );
  } catch (err) {
    console.error("tutor error", err);
    return json({ error: "I am momentarily unable to respond. Please try again in a moment." }, 502, origin);
  }
};

export const config = { path: "/api/tutor" };
