/**
 * Netlify Function (v2 signature) that hosts the tutor statelessly.
 *
 * POST /api/tutor
 *   { "message": "Who was Alexander?", "student": { "age": 12, "name": "Ada" } }
 *   { "message": "And then?", "state": <state returned by the previous call> }
 *
 * Returns { reply, mode, servedBy, usage, state }. The client sends `state`
 * back on every turn; nothing is stored server-side.
 *
 * netlify.toml needs the corpus bundled with the function:
 *   [functions.tutor]
 *     included_files = ["data/great-men.json", "profiles/**", "research/**", "framework/**"]
 *
 * In a separate project, import from "@nova-schola/great-men" instead of ../src.
 */
import { Tutor, type StudentProfile, type TutorState } from "../src/index.js";

interface TutorRequest {
  message: string;
  student?: StudentProfile;
  state?: TutorState;
  model?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: TutorRequest;
  try {
    body = (await req.json()) as TutorRequest;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!body.message?.trim()) return json({ error: "message is required" }, 400);
  if (body.message.length > 4000) return json({ error: "message too long" }, 413);

  const tutor = body.state ? Tutor.fromState(body.state, { model: body.model }) : new Tutor(body.student ?? { age: 12 }, { model: body.model });
  try {
    const reply = await tutor.reply(body.message);
    return json({ reply: reply.text, mode: reply.mode, servedBy: reply.servedBy, refused: reply.refused, usage: reply.usage, state: tutor.toState() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "tutor error";
    return json({ error: message }, 502);
  }
};

export const config = { path: "/api/tutor" };
