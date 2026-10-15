import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadCorpus, readCorpusFile } from "../src/corpus/index.js";
import { handleTutorRequest, stateFromLegacy, type HandlerEnv } from "../src/hosting/handler.js";
import { Tutor } from "../src/inference/tutor.js";

type Msg = Anthropic.Beta.Messages.BetaMessage;

function message(content: Msg["content"], stop: Msg["stop_reason"] = "end_turn"): Msg {
  return {
    id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", stop_sequence: null, stop_details: null, container: null, context_management: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null, iterations: null, speed: null },
    content, stop_reason: stop,
  } as Msg;
}

function fakeClient(script: Msg[]) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const client = {
    beta: { messages: { stream(params: Record<string, unknown>) {
      calls.push(JSON.parse(JSON.stringify(params)));
      const msg = script[i++]!;
      const handlers: Record<string, Array<(d: string) => void>> = {};
      return { on(e: string, cb: (d: string) => void) { (handlers[e] ??= []).push(cb); return this; }, async finalMessage() { for (const b of msg.content) if (b.type === "text") handlers.text?.forEach((cb) => cb(b.text)); return msg; } };
    } } },
  };
  return { client: client as unknown as Anthropic, calls };
}

const corpus = loadCorpus();
const readFile = async (rel: string) => readCorpusFile(rel);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/tutor", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("handleTutorRequest", () => {
  it("rejects non-POST, bad JSON, missing message, and missing configuration", async () => {
    const env: HandlerEnv = { corpus, readFile, client: fakeClient([]).client };
    expect((await handleTutorRequest(new Request("https://x/api/tutor"), env)).status).toBe(405);
    expect((await handleTutorRequest(post("{nope"), env)).status).toBe(400);
    expect((await handleTutorRequest(post({ student: { age: 9 } }), env)).status).toBe(400);
    expect((await handleTutorRequest(post({ message: "hi" }), { corpus, readFile })).status).toBe(503);
    const opt = await handleTutorRequest(new Request("https://x/api/tutor", { method: "OPTIONS", headers: { origin: "https://novaschola.io" } }), { ...env, allowedOrigins: ["https://novaschola.io"] });
    expect(opt.status).toBe(204);
    expect(opt.headers.get("access-control-allow-origin")).toBe("https://novaschola.io");
  });

  it("runs a first turn with injected reader and returns state the next turn resumes", async () => {
    const { client, calls } = fakeClient([
      message([{ type: "tool_use", id: "tu_1", name: "get_student_lesson", input: { figure: "alexander" } }], "tool_use"),
      message([{ type: "text", text: "Watch the horse. What did he see?" }]),
      message([{ type: "text", text: "The shadow." }]),
    ]);
    const reads: string[] = [];
    const env: HandlerEnv = { corpus, client, readFile: async (rel) => { reads.push(rel); return readCorpusFile(rel); } };
    const r1 = await handleTutorRequest(post({ message: "Who was Alexander?", student: { age: 8, name: "Sam<script>" } }), env);
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { message: string; reply: string; mode: string; state: { turns: unknown[]; student: { name?: string; age?: number }; band: string } };
    expect(b1.reply).toBe("Watch the horse. What did he see?");
    expect(b1.message).toBe(b1.reply);
    expect(b1.state.turns.length).toBe(1);
    expect(b1.state.band).toBe("foundational");
    expect(b1.state.student.name).toBe("Samscript");
    expect(reads).toEqual(["profiles/alexander/student-ages-8-10.md"]);
    const toolResult = (calls[1]!.messages as Array<{ content: Array<{ type: string; content?: string }> }>)[2]!.content[0]!;
    expect(toolResult.content).toContain("Shadow-Horse");

    const r2 = await handleTutorRequest(post({ message: "And then?", state: b1.state }), env);
    const b2 = (await r2.json()) as { reply: string; state: { turns: unknown[] } };
    expect(b2.reply).toBe("The shadow.");
    expect(b2.state.turns.length).toBe(2);
    expect((calls[2]!.messages as unknown[]).length).toBe(5);
  });

  it("serves the legacy {messages} contract from the original demo page", async () => {
    const { client, calls } = fakeClient([message([{ type: "text", text: "A king, formed on purpose." }])]);
    const env: HandlerEnv = { corpus, client, readFile };
    const r = await handleTutorRequest(post({ messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Welcome." }, { role: "user", content: "Who was Alexander?" }] }), env);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { message: string; state: { turns: Array<{ student: string }> } };
    expect(b.message).toBe("A king, formed on purpose.");
    expect(b.state.turns.map((t) => t.student)).toEqual(["Hello", "Who was Alexander?"]);
    const msgs = calls[0]!.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(msgs[0]!.content)).toContain("<student_profile>");
    expect(() => stateFromLegacy([{ role: "assistant", content: "x" }], "m")).toThrow(/end with a user message/);
  });

  it("enforces limits", async () => {
    const env: HandlerEnv = { corpus, readFile, client: fakeClient([]).client, maxMessageChars: 10, maxTurns: 1 };
    expect((await handleTutorRequest(post({ message: "this is far too long" }), env)).status).toBe(413);
    const full = new Tutor({ age: 12 }, { corpus, client: env.client, tools: false });
    full.turns.push({ student: "a", tutor: "b", mode: { mode: "grammar", confidence: 1, reason: "" }, toolCalls: [], servedBy: "x" });
    expect((await handleTutorRequest(post({ message: "more", state: full.toState() }), env)).status).toBe(400);
  });
});
