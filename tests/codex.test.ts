import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus/index.js";
import { buildCodexPrompt, codexArgs, parseCodexEvents, runCodexTurn, summarizeCodexEvents, type CodexRunner } from "../src/inference/codex.js";
import { Tutor } from "../src/inference/tutor.js";
import { createLibraryHandlers } from "../src/mcp/server.js";

const SAMPLE = [
  JSON.stringify({ type: "thread.started", thread_id: "01a1-thread" }),
  JSON.stringify({ type: "turn.started" }),
  JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "mcp_tool_call", server: "great_men", tool: "lookup_great_man", arguments: { figure: "alexander" }, status: "completed" } }),
  JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "Alexander saw the shadow. What do you see?" } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 16277, cached_input_tokens: 12288, cache_write_input_tokens: 0, output_tokens: 40, reasoning_output_tokens: 12 } }),
].join("\n");

describe("codex events", () => {
  it("parses JSONL and ignores noise", () => {
    const events = parseCodexEvents("Reading additional input from stdin...\n" + SAMPLE + "\nnot json\n");
    expect(events.length).toBe(5);
  });
  it("summarizes text, thread, usage and tool calls", () => {
    const s = summarizeCodexEvents(parseCodexEvents(SAMPLE));
    expect(s.text).toBe("Alexander saw the shadow. What do you see?");
    expect(s.threadId).toBe("01a1-thread");
    expect(s.usage).toEqual({ inputTokens: 16277 - 12288, outputTokens: 40, cacheReadTokens: 12288, cacheWriteTokens: 0, requests: 1 });
    expect(s.toolCalls).toEqual([{ name: "lookup_great_man", input: { figure: "alexander" }, ok: true }]);
  });
  it("treats error events as fatal only when the turn never completes", () => {
    expect(() => summarizeCodexEvents([{ type: "error", message: "rate limited" }])).toThrow(/rate limited/);
    const recovered = summarizeCodexEvents(parseCodexEvents(JSON.stringify({ type: "error", message: "Reconnecting... 2/5" }) + "\n" + SAMPLE));
    expect(recovered.text).toMatch(/shadow/);
    expect(recovered.warnings).toEqual(["Reconnecting... 2/5"]);
  });
});

describe("codex args and prompt", () => {
  it("isolates the run and serves the library over MCP", () => {
    const args = codexArgs({ cwd: "/tmp/x", model: "gpt-6-astra", effort: "max", defaultAgeRange: "8-10" });
    expect(args[0]).toBe("exec");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--json");
    expect(args.slice(-1)).toEqual(["-"]);
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-6-astra");
    expect(args).toContain('model_reasoning_effort="xhigh"');
    const mcp = args.filter((a) => a.startsWith("mcp_servers.great_men."));
    expect(mcp.length).toBe(3);
    expect(mcp.find((a) => a.includes(".env="))).toMatch(/GREAT_MEN_AGE_RANGE = "8-10"/);
    expect(codexArgs({ cwd: "/tmp/x", tools: false }).some((a) => a.startsWith("mcp_servers"))).toBe(false);
  });
  it("builds a prompt with instructions, context, transcript and the new message", () => {
    const p = buildCodexPrompt({
      systemText: "PERSONA",
      studentContext: "<student_profile>\nage: 12\n</student_profile>",
      transcript: [{ student: "Who was Alexander?", tutor: "A king." }],
      userText: "And then?",
    });
    expect(p).toMatch(/<tutor_instructions>[\s\S]*PERSONA[\s\S]*<\/tutor_instructions>/);
    expect(p).toContain("great_men");
    expect(p).toContain("<student_profile>");
    expect(p).toMatch(/<conversation_so_far>[\s\S]*Student: Who was Alexander\?[\s\S]*Tutor: A king\./);
    expect(p).toMatch(/<student_message>\nAnd then\?\n<\/student_message>/);
  });
});

describe("Tutor on the codex backend", () => {
  const corpus = loadCorpus();
  it("replays the transcript each turn and needs no Anthropic client", async () => {
    const prompts: string[] = [];
    const runner: CodexRunner = async (_args, stdin) => {
      prompts.push(stdin);
      return { stdout: SAMPLE, stderr: "", code: 0 };
    };
    const tutor = new Tutor({ age: 12, name: "Ada" }, { backend: "codex", corpus, codex: { runner } });
    expect(tutor.backend).toBe("codex");
    expect(tutor.model.id).toBe("gpt-6-astra");
    let streamed = "";
    const reply = await tutor.reply("Who was Alexander?", { onText: (d) => (streamed += d) });
    expect(reply.text).toBe("Alexander saw the shadow. What do you see?");
    expect(streamed).toBe(reply.text);
    expect(reply.toolCalls[0]!.name).toBe("lookup_great_man");
    expect(reply.servedBy).toBe("gpt-6-astra");
    expect(prompts[0]).toContain("<student_profile>");
    expect(prompts[0]).not.toContain("<conversation_so_far>");

    await tutor.reply("And then?");
    expect(prompts[1]).toMatch(/<conversation_so_far>[\s\S]*Student: Who was Alexander\?/);
    expect(tutor.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(tutor.usage.requests).toBe(2);

    const state = tutor.toState();
    expect(state.backend).toBe("codex");
    const resumed = Tutor.fromState(state, { corpus, codex: { runner } });
    expect(resumed.backend).toBe("codex");
    expect(resumed.turns.length).toBe(2);
  });
  it("surfaces a failed codex run", async () => {
    const runner: CodexRunner = async () => ({ stdout: "", stderr: "codex: not logged in\n", code: 1 });
    await expect(runCodexTurn("hi", { runner })).rejects.toThrow(/not logged in/);
  });
});

describe("MCP library handlers", () => {
  const { listTools, callTool } = createLibraryHandlers({ defaultAgeRange: "11-14" });
  it("lists the six tools with JSON schemas", async () => {
    const { tools } = await listTools();
    expect(tools.map((t) => t.name)).toEqual(["find_exempla", "get_discussion_questions", "get_parent_guide", "get_student_lesson", "get_week_plan", "lookup_great_man"]);
    for (const t of tools) expect((t.inputSchema as { type: string }).type).toBe("object");
  });
  it("runs a tool and reports errors as isError", async () => {
    const ok = await callTool("lookup_great_man", { figure: "Churchill" });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0]!.text).toContain("Winston Churchill");
    const bad = await callTool("lookup_great_man", { figure: 7 });
    expect(bad.isError).toBe(true);
    const unknown = await callTool("nope", {});
    expect(unknown.isError).toBe(true);
  });
});
