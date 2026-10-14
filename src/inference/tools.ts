/**
 * Client-side tools that give the tutor the full Great Men material on
 * demand. Definitions are deterministic (sorted by name, no dynamic text) so
 * the tools prefix caches.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { readCorpusFile, REPO_ROOT } from "../corpus/index.js";
import { splitSections } from "../corpus/parse.js";
import { ageRangeFor, findExempla, findProfile } from "../corpus/search.js";
import { SPINE_ORDER } from "../corpus/spine.js";
import { AGE_RANGES, type AgeRange, type Corpus, type Profile } from "../corpus/types.js";

/** A library tool: a plain Beta tool definition plus the Zod-backed `parse` and `run` the Tutor calls. */
export interface TutorTool {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.Messages.BetaTool["input_schema"];
  /** Validates raw model input against the Zod schema; throws on mismatch. */
  parse: (content: unknown) => unknown;
  run: (args: never) => Promise<string> | string;
}

function define<S extends z.ZodType>(options: {
  name: string;
  description: string;
  inputSchema: S;
  run: (args: z.infer<S>) => Promise<string> | string;
}): TutorTool {
  // betaZodTool builds the JSON schema and the validating parse(); the cast narrows
  // the SDK's runnable-tool union to the custom-tool shape we always produce here.
  return betaZodTool(options) as unknown as TutorTool;
}

const AgeRangeSchema = z.enum(["8-10", "11-14", "15-18"]);

function notFound(corpus: Corpus, figure: string): string {
  const near = findExempla(corpus, { query: figure, limit: 3 }).map((h) => `${h.name} [${h.slug}]`);
  const all = corpus.figures.map((f) => f.slug).join(", ");
  return `No profile for "${figure}" in the library.${near.length ? ` Closest by theme: ${near.join("; ")}.` : ""} Available: ${all}.`;
}

export function profileOverview(p: Profile): string {
  const sig = p.signature;
  const lines = [
    `# ${p.name}: ${p.subtitle}`,
    `Born ${p.born}. Died ${p.died}. Era: ${p.era}. Domain: ${p.domain}. Day ${p.day} of the sequence.`,
    "",
    "## The one-minute story",
    p.oneMinuteStory,
    "",
  ];
  if (p.teaches.length) lines.push("## Teaches", ...p.teaches.map((t) => `- ${t}`), "");
  if (p.warnsAgainst.length) lines.push("## Warns against", ...p.warnsAgainst.map((t) => `- ${t}`), "");
  if (p.formationChallenge) lines.push("## Formation challenge", p.formationChallenge, "");
  if (sig.virtues.length) lines.push("## Virtues to imitate", ...sig.virtues.map((b) => `- ${b.text}`), "");
  if (sig.risks.length) lines.push("## Risks to guard against", ...sig.risks.map((b) => `- ${b.text}`), "");
  if (sig.formedBy.length) lines.push("## How he was formed", ...sig.formedBy.map((b) => `- ${b.text}`), "");
  const spineLines = SPINE_ORDER.filter((v) => p.spine[v]).map((v) => {
    const e = p.spine[v]!;
    const parts = [];
    if (e.imitate.length) parts.push(`imitate ${e.imitate.join(", ")}`);
    if (e.guard.length) parts.push(`guard against ${e.guard.join(", ")}`);
    return `- ${v}: ${parts.join("; ")}`;
  });
  if (spineLines.length) lines.push("## Virtue spine", ...spineLines, "");
  if (sig.quote) lines.push(`## Epigraph`, `"${sig.quote}"`, "");
  if (sig.corePractice) lines.push("## Core practice", sig.corePractice, "");
  lines.push(
    "## Student lessons available",
    ...AGE_RANGES.map((r) => `- Ages ${r}: ${p.lessons[r].title} (${p.lessons[r].wordCount} words)`),
  );
  if (p.research.misconceptions.length) {
    lines.push("", "## Common misconceptions", ...p.research.misconceptions.map((m) => `- Myth: ${m.myth} Reality: ${m.reality}`));
  }
  return lines.join("\n");
}

function researchSummary(p: Profile): string {
  const r = p.research;
  const lines = [`# ${p.name}: research summary`];
  if (r.famousFor) lines.push(`Famous for: ${r.famousFor}`);
  if (r.keyVirtues.length) lines.push(`Key virtues: ${r.keyVirtues.join(", ")}`);
  if (r.keyFlaws.length) lines.push(`Key flaws: ${r.keyFlaws.join(", ")}`);
  if (r.essentialQuestion) lines.push("", "## Essential question", r.essentialQuestion);
  if (r.definingMoments.length) lines.push("", "## Defining moments", ...r.definingMoments.map((m) => `- ${m}`));
  if (r.failures.length) lines.push("", "## Failures and recovery", ...r.failures.map((m) => `- ${m}`));
  if (r.coreLessons.length) lines.push("", "## Core lessons", ...r.coreLessons.map((m) => `- ${m}`));
  if (r.whenToReference.length) lines.push("", "## When to reference this figure", ...r.whenToReference.map((m) => `- ${m}`));
  lines.push("", `Full essay: ${r.path} (${r.wordCount} words). Request section "research_full" for the whole text.`);
  return lines.join("\n");
}

function sectionOf(markdown: string, wanted?: string): string {
  if (!wanted) return markdown;
  const sections = splitSections(markdown);
  const w = wanted.toLowerCase();
  const hit = sections.find((s) => s.title.toLowerCase().includes(w));
  if (hit) return `## ${hit.title}\n\n${hit.body}`;
  return `No section matching "${wanted}". Sections: ${sections.map((s) => s.title).join(" | ")}`;
}

export interface ToolOptions {
  /** Repo root that holds profiles/ and research/. */
  root?: string;
  /** Lesson range used when the model omits age_range (from the student's band). */
  defaultAgeRange?: AgeRange;
}

/** Build the tutor's tool set, sorted by name for a stable prefix. */
export function makeTutorTools(corpus: Corpus, options: ToolOptions = {}): TutorTool[] {
  const root = options.root ?? REPO_ROOT;
  const defaultRange = options.defaultAgeRange ?? "11-14";
  const resolve = (figure: string) => findProfile(corpus, figure);

  const lookupGreatMan = define({
    name: "lookup_great_man",
    description:
      "Return a figure's profile from the Great Men library. Default section is a structured overview (story, what he teaches and warns against, virtues, risks, how he was formed). Call this before discussing a figure in any depth.",
    inputSchema: z.object({
      figure: z.string().describe("Name or slug, e.g. 'alexander', 'Marcus Aurelius', 'da Vinci'"),
      section: z
        .enum(["overview", "story", "why_he_matters", "formation_signature", "quick_practice", "sequence", "misconceptions", "research_summary", "research_full"])
        .optional()
        .describe("Which part to return; defaults to overview"),
    }),
    run: async ({ figure, section }) => {
      const p = resolve(figure);
      if (!p) return notFound(corpus, figure);
      switch (section ?? "overview") {
        case "story":
          return `# ${p.name}\n\n${p.oneMinuteStory}`;
        case "why_he_matters":
          return p.sections["Why He Matters for Your Child"] ?? profileOverview(p);
        case "formation_signature":
          return p.sections["Formation Signature"] ?? profileOverview(p);
        case "quick_practice":
          return p.sections["Quick Practice Ideas"] ?? `No quick-practice section shipped for ${p.name}; use the student lesson practices instead.`;
        case "sequence":
          return p.sequenceNote ?? `${p.name} is Day ${p.day} of the sequence (${p.eraGroup}).`;
        case "misconceptions": {
          const items = [
            ...p.research.misconceptions.map((m) => `- Myth: ${m.myth}\n  Reality: ${m.reality}`),
            ...p.parentGuide.misconceptions.map((m) => `- ${m}`),
          ];
          return items.length ? `# ${p.name}: misconceptions to correct\n${items.join("\n")}` : `No misconception list shipped for ${p.name}.`;
        }
        case "research_summary":
          return researchSummary(p);
        case "research_full":
          return readCorpusFile(p.research.path, root);
        default:
          return profileOverview(p);
      }
    },
  });

  const findExemplaTool = define({
    name: "find_exempla",
    description:
      "Search the library for figures whose virtues, risks or lessons match a virtue to imitate, a struggle to address, a spine virtue, or a free-text situation. Returns ranked figures with the matching lines. Use when you need an example and have not chosen a figure.",
    inputSchema: z.object({
      query: z.string().optional().describe("Free text: a situation, subject or theme"),
      virtue: z.string().optional().describe("A virtue to imitate, e.g. 'patience', 'courage', 'observation'"),
      struggle: z.string().optional().describe("A struggle or vice to address, e.g. 'pride', 'quitting', 'fear of being wrong'"),
      era: z.enum(["ancient", "medieval", "renaissance", "modern"]).optional(),
      domain: z.string().optional().describe("Restrict to a domain word, e.g. 'science', 'military', 'philosophy'"),
      spine: z
        .enum(["temperance", "fortitude", "justice", "prudence", "magnanimity", "magnificence"])
        .optional()
        .describe("Restrict to figures taught under one spine virtue (imitate or guard)"),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    run: async (q) => {
      const hits = findExempla(corpus, q);
      if (!hits.length) return "No figure matched. Try a broader virtue or struggle, or drop the era/domain filter.";
      return hits
        .map((h) => `${h.name} [${h.slug}] (${h.eraGroup}; ${h.domain}) — ${h.subtitle}\n  ${h.evidence.map((e) => `• ${e}`).join("\n  ")}`)
        .join("\n\n");
    },
  });

  const getStudentLesson = define({
    name: "get_student_lesson",
    description:
      "Return the student lesson for a figure at an age range (8-10, 11-14 or 15-18), or one named section of it. Lessons are 1,500-6,000 words: the story told for that age, the central question, discussion questions and practices. Use the student's own range unless they ask to go deeper.",
    inputSchema: z.object({
      figure: z.string(),
      age_range: AgeRangeSchema.optional().describe("Defaults to the student's band"),
      section: z.string().optional().describe("Return only the section whose heading contains this text, e.g. 'Discussion', 'Story', 'Practices'"),
    }),
    run: async ({ figure, age_range, section }) => {
      const p = resolve(figure);
      if (!p) return notFound(corpus, figure);
      const range = age_range ?? defaultRange;
      return sectionOf(readCorpusFile(p.lessons[range].path, root), section);
    },
  });

  const getDiscussionQuestions = define({
    name: "get_discussion_questions",
    description: "Return the discussion questions written for a figure at an age range, plus the lesson's essential question.",
    inputSchema: z.object({
      figure: z.string(),
      age_range: AgeRangeSchema.optional(),
      age: z.number().int().optional().describe("Alternative to age_range: the student's age"),
    }),
    run: async ({ figure, age_range, age }) => {
      const p = resolve(figure);
      if (!p) return notFound(corpus, figure);
      const range = age_range ?? (age !== undefined ? ageRangeFor(age) : defaultRange);
      const lesson = p.lessons[range];
      const lines = [`# ${p.name}, ages ${range}: ${lesson.title}`];
      if (lesson.essentialQuestion) lines.push(`Essential question: ${lesson.essentialQuestion}`, "");
      if (lesson.discussionQuestions.length) lines.push(...lesson.discussionQuestions.map((q, i) => `${i + 1}. ${q}`));
      else lines.push("(No discussion list extracted; request the lesson's 'Discussion' or 'Questions' section.)");
      return lines.join("\n");
    },
  });

  const getParentGuide = define({
    name: "get_parent_guide",
    description:
      "Return the parent teaching guide for a figure (age-appropriate emphases, what to leave for later, misconceptions, facilitation tips, assessment), or one named section. Use when advising a parent or when deciding what is appropriate for a young student.",
    inputSchema: z.object({
      figure: z.string(),
      section: z.string().optional().describe("Heading text to filter to, e.g. 'Age', 'Misconceptions', 'Sensitive'"),
    }),
    run: async ({ figure, section }) => {
      const p = resolve(figure);
      if (!p) return notFound(corpus, figure);
      return sectionOf(readCorpusFile(p.parentGuide.path, root), section);
    },
  });

  const getWeekPlan = define({
    name: "get_week_plan",
    description: "Return the five-day lesson plan for a figure (materials, daily sessions, project, assessment), or one named section such as 'Monday' or 'Assessment'.",
    inputSchema: z.object({
      figure: z.string(),
      section: z.string().optional(),
    }),
    run: async ({ figure, section }) => {
      const p = resolve(figure);
      if (!p) return notFound(corpus, figure);
      return sectionOf(readCorpusFile(p.weekPlan.path, root), section);
    },
  });

  const tools = [findExemplaTool, getDiscussionQuestions, getParentGuide, getStudentLesson, getWeekPlan, lookupGreatMan];
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}
