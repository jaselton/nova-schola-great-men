/**
 * Eval runner: plays each case through the Tutor, then grades the reply
 * against the case rubric with a judge model (Claude Haiku 5.5 by default).
 *
 *   npm run eval -- [--model tutor|fast|frontier] [--judge <id>] [--only <id,id>] [--limit N] [--no-tools]
 *   npm run eval -- --backend codex [--model gpt-6-astra]      # tutor and judge through the local Codex CLI
 *
 * Every run spends real money (roughly $0.05-0.15 per case on Opus 5.5 with a
 * warm cache). Results land in evals/results/<timestamp>.json.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadCorpus } from "../src/corpus/index.js";
import { CODEX_DEFAULT_MODEL, runCodexTurn } from "../src/inference/codex.js";
import { addUsage, emptyUsage, estimateCost, MODELS, resolveModel, type UsageLike } from "../src/inference/models.js";
import type { TriviumMode } from "../src/inference/router.js";
import { Tutor, type StudentProfile } from "../src/inference/tutor.js";

interface EvalCase {
  id: string;
  student: StudentProfile;
  message: string;
  expectedMode: TriviumMode;
  expectedFigures: string[];
  rubric: string[];
}

const JudgeSchema = z.object({
  criteria: z.array(z.object({ criterion: z.string(), pass: z.boolean(), evidence: z.string() })),
  modeObserved: z.enum(["grammar", "logic", "rhetoric"]),
  endsWithForwardMotion: z.boolean(),
  flattersOrPadsWithPraise: z.boolean(),
  mentionsToolsOrCorpus: z.boolean(),
  usesMarkdownListsOrHeaders: z.boolean(),
  score: z.number().int().min(1).max(5).describe("Overall quality as a Nova Schola tutor turn"),
});

const JUDGE_SYSTEM = `You grade one turn of an AI tutor built on Nova Schola's classical-formation framework. The tutor is one voice with three internal modes: grammar (facts, definitions, stories), logic (reasoning, evidence, why), rhetoric (expression, writing, judgment, synthesis). It should never flatter, never lower standards, never mention tools or a corpus, write in prose without lists or headers unless asked, and end with forward motion (a question, challenge, or next step). Grade strictly against the rubric. Quote the evidence for each judgment.`;

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      model: { type: "string" },
      judge: { type: "string" },
      only: { type: "string" },
      limit: { type: "string" },
      "no-tools": { type: "boolean", default: false },
      backend: { type: "string" },
    },
  });
  const backend = v.backend === "codex" ? "codex" : "anthropic";
  const cases = (JSON.parse(readFileSync(join(here, "cases.json"), "utf8")) as EvalCase[])
    .filter((c) => !v.only || v.only.split(",").includes(c.id))
    .slice(0, v.limit ? Number(v.limit) : undefined);
  const client = backend === "anthropic" ? new Anthropic() : undefined;
  const corpus = loadCorpus();
  const tutorSpec = backend === "codex" ? resolveModel(v.model ?? "codex") : resolveModel(v.model);
  const judgeSpec = backend === "codex" ? resolveModel(v.judge ?? tutorSpec.id) : resolveModel(v.judge ?? MODELS.classifier.id);
  const judgeSchemaJson = z.toJSONSchema(JudgeSchema) as Record<string, unknown>;

  /** Grade one reply; Anthropic structured output or Codex --output-schema, depending on backend. */
  async function judgeReply(userContent: string): Promise<{ verdict: z.infer<typeof JudgeSchema> | null; usage: UsageLike }> {
    if (backend === "codex") {
      const turn = await runCodexTurn(`${JUDGE_SYSTEM}\n\n${userContent}\n\nRespond with JSON matching the required schema and nothing else.`, {
        model: judgeSpec.id === "codex" ? CODEX_DEFAULT_MODEL : judgeSpec.id,
        effort: "low",
        tools: false,
        outputSchema: judgeSchemaJson,
      });
      const start = turn.text.indexOf("{");
      const end = turn.text.lastIndexOf("}");
      const parsed = start >= 0 && end > start ? JudgeSchema.safeParse(JSON.parse(turn.text.slice(start, end + 1))) : null;
      return {
        verdict: parsed?.success ? parsed.data : null,
        usage: { input_tokens: turn.usage.inputTokens, output_tokens: turn.usage.outputTokens, cache_read_input_tokens: turn.usage.cacheReadTokens },
      };
    }
    const judge = await client!.messages.parse({
      model: judgeSpec.id,
      max_tokens: 4000,
      system: JUDGE_SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(JudgeSchema) },
      messages: [{ role: "user", content: userContent }],
    });
    return { verdict: judge.parsed_output ?? null, usage: judge.usage };
  }
  const judgeUsage = emptyUsage();
  const tutorUsage = emptyUsage();
  const results: Array<Record<string, unknown>> = [];

  console.log(`Running ${cases.length} cases on ${tutorSpec.label} via ${backend}, judged by ${judgeSpec.label}\n`);
  for (const c of cases) {
    const tutor = new Tutor(c.student, { client, corpus, model: tutorSpec.id, backend, tools: !v["no-tools"] });
    const started = Date.now();
    const reply = await tutor.reply(c.message);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    for (const k of Object.keys(tutorUsage) as Array<keyof typeof tutorUsage>) tutorUsage[k] += reply.usage[k];

    const judgeInput = `Student profile: ${JSON.stringify(c.student)}\nExpected trivium mode: ${c.expectedMode}\nFigures the tutor was expected to draw on (any of): ${c.expectedFigures.join(", ") || "none in particular"}\n\nRubric:\n${c.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n<student_message>\n${c.message}\n</student_message>\n\n<tutor_reply>\n${reply.text}\n</tutor_reply>\n\nTools the tutor called: ${reply.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join("; ") || "none"}`;
    const judged = await judgeReply(judgeInput);
    addUsage(judgeUsage, judged.usage);
    const verdict = judged.verdict;
    const passed = verdict ? verdict.criteria.filter((x) => x.pass).length : 0;
    const total = c.rubric.length;
    const figureHit = c.expectedFigures.length === 0 || reply.toolCalls.some((t) => c.expectedFigures.some((f) => JSON.stringify(t.input).toLowerCase().includes(f.split("-")[0]!)));
    const modeHit = verdict?.modeObserved === c.expectedMode;
    console.log(
      `${c.id.padEnd(30)} ${passed}/${total} rubric | score ${verdict?.score ?? "?"}/5 | mode ${verdict?.modeObserved ?? "?"}${modeHit ? "" : ` (expected ${c.expectedMode})`} | figures ${figureHit ? "ok" : "miss"} | tools ${reply.toolCalls.length} | ${seconds}s` +
        (verdict?.flattersOrPadsWithPraise ? " | FLATTERY" : "") +
        (verdict?.mentionsToolsOrCorpus ? " | LEAKS TOOLS" : "") +
        (verdict?.usesMarkdownListsOrHeaders ? " | MARKDOWN" : "") +
        (verdict && !verdict.endsWithForwardMotion ? " | NO FORWARD MOTION" : ""),
    );
    results.push({ id: c.id, student: c.student, message: c.message, reply: reply.text, toolCalls: reply.toolCalls, heuristicMode: reply.mode, verdict, passed, total, figureHit, modeHit, seconds: Number(seconds), servedBy: reply.servedBy });
  }

  const totalPassed = results.reduce((a, r) => a + (r.passed as number), 0);
  const totalCriteria = results.reduce((a, r) => a + (r.total as number), 0);
  const meanScore = results.reduce((a, r) => a + (((r.verdict as { score?: number } | null)?.score) ?? 0), 0) / Math.max(results.length, 1);
  const cost = estimateCost(tutorUsage, tutorSpec) + estimateCost(judgeUsage, judgeSpec);
  console.log(`\nRubric ${totalPassed}/${totalCriteria} (${((100 * totalPassed) / Math.max(totalCriteria, 1)).toFixed(0)}%) | mean score ${meanScore.toFixed(2)}/5 | mode match ${results.filter((r) => r.modeHit).length}/${results.length} | est. cost $${cost.toFixed(3)}`);
  const out = join(here, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify({ backend, tutorModel: tutorSpec.id, judgeModel: judgeSpec.id, tutorUsage, judgeUsage, estimatedCostUsd: cost, results }, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
