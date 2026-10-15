import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus/index.js";
import { Tutor } from "../src/inference/tutor.js";

type Msg = Anthropic.Beta.Messages.BetaMessage;

function message(partial: Partial<Msg> & { content: Msg["content"]; stop_reason: Msg["stop_reason"] }): Msg {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 80,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
    },
    ...partial,
  } as Msg;
}

/** A scripted stand-in for client.beta.messages.stream that records every request. */
function fakeClient(script: Msg[]) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const msg = script[i++];
          if (!msg) throw new Error("script exhausted");
          const handlers: Record<string, Array<(d: string) => void>> = {};
          return {
            on(event: string, cb: (d: string) => void) {
              (handlers[event] ??= []).push(cb);
              return this;
            },
            async finalMessage() {
              for (const b of msg.content) if (b.type === "text") handlers.text?.forEach((cb) => cb(b.text));
              return msg;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const corpus = loadCorpus();

describe("Tutor", () => {
  it("runs a tool round, then answers, with a stable cached prefix", async () => {
    const { client, calls } = fakeClient([
      message({
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "tool_use", id: "tu_1", name: "lookup_great_man", input: { figure: "alexander" } },
        ],
      }),
      message({ stop_reason: "end_turn", content: [{ type: "text", text: "Alexander saw the shadow. What do you see?" }] }),
    ]);
    const tutor = new Tutor({ name: "Ada", age: 12, subject: "History" }, { client, corpus });
    expect(tutor.band).toBe("formative");
    let streamed = "";
    const reply = await tutor.reply("Who was Alexander?", { onText: (d) => (streamed += d) });

    expect(reply.text).toBe("Alexander saw the shadow. What do you see?");
    expect(streamed).toBe(reply.text);
    expect(reply.mode.mode).toBe("grammar");
    expect(reply.toolCalls).toEqual([{ name: "lookup_great_man", input: { figure: "alexander" }, ok: true }]);
    expect(reply.servedBy).toBe("claude-opus-5-5");
    expect(reply.usage.requests).toBe(2);
    expect(tutor.usage.cacheReadTokens).toBe(18000);

    // Request shape
    const first = calls[0]!;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(first.fallbacks).toBe("default");
    expect(first.thinking).toEqual({ type: "adaptive" });
    expect(first.output_config).toEqual({ effort: "medium" });
    const system = first.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[system.length - 1]!.cache_control).toEqual({ type: "ephemeral" });
    const tools = first.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toEqual([...tools.map((t) => t.name)].sort());
    const msgs0 = first.messages as Array<{ role: string; content: Array<{ type: string; text?: string; cache_control?: unknown }> }>;
    expect(msgs0[0]!.content[0]!.text).toContain("<student_profile>");
    expect(msgs0[0]!.content[1]!.text).toBe("Who was Alexander?");

    // Second request carries the tool result and exactly one message-level marker
    const second = calls[1]!;
    const msgs1 = second.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(msgs1.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const result = msgs1[2]!.content[0]!;
    expect(result.type).toBe("tool_result");
    expect(String(result.content)).toContain("Alexander the Great");
    const markers = msgs1.flatMap((m) => m.content).filter((b) => b.cache_control).length;
    expect(markers).toBe(1);
    // Thinking block passed back unchanged
    expect(msgs1[1]!.content[0]!.type).toBe("thinking");

    // History and state
    expect(tutor.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(tutor.turns.length).toBe(1);
    const state = tutor.toState();
    const resumed = Tutor.fromState(state, { client, corpus });
    expect(resumed.messages.length).toBe(4);
    expect(resumed.band).toBe("formative");
  });

  it("flags invalid tool input as an error result and keeps going", async () => {
    const { client, calls } = fakeClient([
      message({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "lookup_great_man", input: { figure: 42 } }] }),
      message({ stop_reason: "end_turn", content: [{ type: "text", text: "Let us begin with Plutarch." }] }),
    ]);
    const tutor = new Tutor({ age: 16 }, { client, corpus });
    const reply = await tutor.reply("Tell me about Alexander");
    expect(reply.toolCalls[0]!.ok).toBe(false);
    const msgs = calls[1]!.messages as Array<{ content: Array<{ is_error?: boolean }> }>;
    expect(msgs[2]!.content[0]!.is_error).toBe(true);
    expect(reply.text).toBe("Let us begin with Plutarch.");
    expect(tutor.effort).toBe("high");
  });

  it("handles a refusal gracefully", async () => {
    const { client } = fakeClient([message({ stop_reason: "refusal", content: [] })]);
    const tutor = new Tutor({ age: 10 }, { client, corpus });
    const reply = await tutor.reply("something off-limits");
    expect(reply.refused).toBe(true);
    expect(reply.text).toMatch(/return to the work/);
  });

  it("can run without tools or fallbacks", async () => {
    const { client, calls } = fakeClient([message({ stop_reason: "end_turn", content: [{ type: "text", text: "Yes." }] })]);
    const tutor = new Tutor({ age: 7, parentMode: true }, { client, corpus, tools: false, fallbacks: false, model: "fast", effort: "low" });
    await tutor.reply("Is Alexander appropriate for a seven-year-old?");
    const p = calls[0]!;
    expect(p.tools).toEqual([]);
    expect(p.betas).toBeUndefined();
    expect(p.fallbacks).toBeUndefined();
    expect(p.model).toBe("claude-sonnet-5-5");
    const system = (p.system as Array<{ text: string }>).map((b) => b.text).join();
    expect(system).toContain("PARENT or TEACHER");
    const msgs = p.messages as Array<{ content: Array<{ text: string }> }>;
    expect(msgs[0]!.content[0]!.text).toContain("<parent_or_teacher_profile>");
  });

  it("stops tool rounds at the budget", async () => {
    const loop = message({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_x", name: "find_exempla", input: { virtue: "courage" } }] });
    const { client, calls } = fakeClient([loop, loop, loop, message({ stop_reason: "end_turn", content: [{ type: "text", text: "Enough." }] })]);
    const tutor = new Tutor({ age: 12 }, { client, corpus, maxToolRounds: 2 });
    const reply = await tutor.reply("Who is brave?");
    expect(reply.text).toBe("Enough.");
    expect(calls.length).toBe(4);
    expect(reply.toolCalls.map((c) => c.ok)).toEqual([true, true, false]);
  });
});
