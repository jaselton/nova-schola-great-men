/**
 * Structured review of an existing figure: factual concerns, age calibration,
 * template gaps, strengths, priority fixes. Uses structured outputs so the
 * report is machine-readable as well as a markdown file a human can act on.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { loadCorpus, readCorpusFile, REPO_ROOT } from "../corpus/index.js";
import { findProfile } from "../corpus/search.js";
import { AGE_RANGES, type Profile } from "../corpus/types.js";
import { addUsage, emptyUsage, estimateCost, FALLBACK_BETA, resolveModel, type Effort } from "../inference/models.js";

export const ReviewSchema = z.object({
  summary: z.string().describe("Three or four sentences on the profile set as a whole"),
  overallGrade: z.enum(["A", "B", "C", "D"]),
  factualConcerns: z.array(
    z.object({
      file: z.string(),
      claim: z.string().describe("The sentence or claim as written"),
      concern: z.string().describe("What is wrong, disputed, anachronistic or unsourced"),
      confidence: z.enum(["high", "medium", "low"]).describe("How sure the reviewer is that this is an error"),
      suggestedFix: z.string(),
    }),
  ),
  ageCalibration: z.array(
    z.object({
      file: z.string(),
      issue: z.string(),
      severity: z.enum(["high", "medium", "low"]),
    }),
  ).describe("Places where a lesson is pitched too high or too low for its age range, or where content the parent guide says to leave for later appears in the 8-10 lesson"),
  templateGaps: z.array(z.object({ file: z.string(), gap: z.string() })).describe("Sections the framework template or the house pattern expects that are missing or thin"),
  strengths: z.array(z.string()),
  priorityFixes: z.array(z.string()).describe("Ordered list of the changes that matter most"),
});

export type Review = z.infer<typeof ReviewSchema>;

export interface ReviewOptions {
  figure: string;
  model?: string;
  effort?: Effort;
  /** Directory for the report (default <root>/reviews). */
  outDir?: string;
  root?: string;
  client?: Anthropic;
  onStage?: (stage: string) => void;
}

export interface ReviewResult {
  review: Review;
  markdown: string;
  files: string[];
  estimatedCostUsd: number;
}

const REVIEWER_SYSTEM = `You are a senior reviewer for Nova Schola's Great Men curriculum: a classical historian and an experienced classical-school teacher in one. You are given the pedagogical framework, the profile template, and every file for one figure. Review the set for factual accuracy (dates, attributions, quotations, causation), for age calibration across the three student lessons, for conformance to the template and the house pattern, and for pedagogical quality in the Nova Schola sense: virtue and risk both taught, formation made visible, forward motion for the student. Be specific: quote the claim, name the file, say what to change. Distinguish settled errors from scholarly disputes. Praise only what is actually strong.`;

function gatherFiles(p: Profile, root: string): Array<{ path: string; text: string }> {
  const paths = [p.readmePath, ...AGE_RANGES.map((r) => p.lessons[r].path), p.parentGuide.path, p.weekPlan.path, p.research.path];
  return paths.map((path) => ({ path, text: readCorpusFile(path, root) }));
}

export function renderReview(p: Profile, review: Review, model: string): string {
  const lines: string[] = [`# Review: ${p.name} (${p.slug})`, "", `Reviewer model: ${model}. Grade: **${review.overallGrade}**.`, "", review.summary, ""];
  const section = (title: string, items: string[]) => {
    lines.push(`## ${title}`, "");
    if (!items.length) lines.push("None noted.", "");
    else lines.push(...items.map((i) => `- ${i}`), "");
  };
  section("Priority fixes", review.priorityFixes);
  section(
    "Factual concerns",
    review.factualConcerns.map((c) => `**${c.file}** (${c.confidence}): "${c.claim}" — ${c.concern} *Fix:* ${c.suggestedFix}`),
  );
  section("Age calibration", review.ageCalibration.map((a) => `**${a.file}** (${a.severity}): ${a.issue}`));
  section("Template gaps", review.templateGaps.map((g) => `**${g.file}**: ${g.gap}`));
  section("Strengths", review.strengths);
  return lines.join("\n");
}

export async function reviewProfile(opts: ReviewOptions): Promise<ReviewResult> {
  const root = opts.root ?? REPO_ROOT;
  const corpus = loadCorpus(root);
  const p = findProfile(corpus, opts.figure);
  if (!p) throw new Error(`No profile for "${opts.figure}".`);
  const client = opts.client ?? new Anthropic();
  const spec = resolveModel(opts.model);
  const usage = emptyUsage();

  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
    { type: "text", text: REVIEWER_SYSTEM },
    { type: "text", text: `# framework/GREAT_MAN_FRAMEWORK.md\n\n${readCorpusFile("framework/GREAT_MAN_FRAMEWORK.md", root)}` },
    { type: "text", text: `# framework/PROFILE_TEMPLATE.md\n\n${readCorpusFile("framework/PROFILE_TEMPLATE.md", root)}`, cache_control: { type: "ephemeral" } },
  ];
  const files = gatherFiles(p, root);
  const userText = files.map((f) => `<file path="${f.path}">\n${f.text}\n</file>`).join("\n\n") + `\n\nReview the complete set for ${p.name}.`;

  opts.onStage?.(`reviewing ${p.name} with ${spec.label} (${files.length} files)`);
  const stream = client.beta.messages.stream({
    model: spec.id,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: userText }],
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "high", format: zodOutputFormat(ReviewSchema) },
    ...(spec.serverFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  });
  const message = await stream.finalMessage();
  addUsage(usage, message.usage);
  if (message.stop_reason === "refusal") throw new Error("The reviewer model declined.");
  const review = message.parsed_output;
  if (!review) throw new Error("The review did not parse; re-run or lower the file count.");

  const markdown = renderReview(p, review, spec.label);
  const outDir = opts.outDir ?? join(root, "reviews");
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, `${p.slug}.md`);
  const jsonPath = join(outDir, `${p.slug}.json`);
  writeFileSync(mdPath, markdown + "\n");
  writeFileSync(jsonPath, JSON.stringify({ figure: p.slug, model: spec.id, review }, null, 2) + "\n");
  return { review, markdown, files: [mdPath, jsonPath], estimatedCostUsd: estimateCost(usage, spec) };
}
