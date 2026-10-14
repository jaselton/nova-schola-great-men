/**
 * Markdown -> structured Profile.
 *
 * The profiles were hand-written over 25 days and are not perfectly uniform
 * (three of them lead "Formation Signature" with a quote instead of the
 * Virtues/Risks/Formed-by triplet, headings vary across student lessons,
 * one research file has no metadata table). Every extractor here degrades to
 * an empty value rather than throwing, and the raw README sections are kept
 * verbatim so nothing is lost to the parser.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FIGURES, type FigureSeed } from "./catalog.js";
import { virtueSpine } from "./spine.js";
import {
  AGE_RANGES,
  type AgeRange,
  type Bullet,
  type Corpus,
  type FormationSignature,
  type LessonSummary,
  type ParentGuideSummary,
  type Profile,
  type ResearchSummary,
  type WeekPlanSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Generic markdown helpers
// ---------------------------------------------------------------------------

export interface Section {
  level: number;
  title: string;
  body: string;
}

/** Split markdown into sections at headings of the given level (default H2). */
export function splitSections(md: string, level = 2): Section[] {
  const marker = "#".repeat(level) + " ";
  const sections: Section[] = [];
  let current: Section | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) {
      current.body = buf.join("\n").trim();
      sections.push(current);
    }
    buf.length = 0;
  };
  for (const line of md.split("\n")) {
    if (line.startsWith(marker)) {
      flush();
      current = { level, title: line.slice(marker.length).trim(), body: "" };
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Find a section whose title starts with (case-insensitive) one of the prefixes. */
export function findSection(sections: Section[], ...prefixes: string[]): Section | undefined {
  const wanted = prefixes.map((p) => p.toLowerCase());
  return sections.find((s) => wanted.some((w) => s.title.toLowerCase().startsWith(w)));
}

/** Remove markdown emphasis, links and inline code from a line. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse "- **Title** — detail" style bullets from a block of markdown. */
export function parseBullets(body: string): Bullet[] {
  const bullets: Bullet[] = [];
  for (const raw of body.split("\n")) {
    const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(raw);
    if (!m) continue;
    const line = m[1]!;
    const lead = /^\*{2,3}([^*]+)\*{2,3}\s*(?:[—:–-]\s*)?(.*)$/.exec(line);
    if (lead) {
      bullets.push({
        title: stripMarkdown(lead[1]!),
        detail: stripMarkdown(lead[2] ?? ""),
        text: stripMarkdown(line),
      });
    } else {
      const text = stripMarkdown(line);
      bullets.push({ title: text, detail: "", text });
    }
  }
  return bullets;
}

/** Numbered ("1. ...") or bulleted lines, as plain text. */
export function parseListItems(body: string): string[] {
  const items: string[] = [];
  for (const raw of body.split("\n")) {
    const m = /^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/.exec(raw);
    if (m) items.push(stripMarkdown(m[1]!));
  }
  return items;
}

/** First non-empty paragraph of a body, markdown stripped. */
export function firstParagraph(body: string): string | undefined {
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("---") && !p.startsWith("#"));
  const first = paras[0];
  return first ? stripMarkdown(first.replace(/^>\s?/gm, "")) : undefined;
}

/** Value of a "**Label:** value" line anywhere in the document. */
export function metaLine(md: string, label: string): string {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, "m");
  const m = re.exec(md);
  return m ? stripMarkdown(m[1]!) : "";
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

// ---------------------------------------------------------------------------
// README (profile overview)
// ---------------------------------------------------------------------------

interface WhyHeMatters {
  teaches: string[];
  warnsAgainst: string[];
  formationChallenge?: string;
}

function parseWhyHeMatters(body: string): WhyHeMatters {
  const out: WhyHeMatters = { teaches: [], warnsAgainst: [] };
  // Split at bold lead lines such as "**Alexander teaches:**".
  const chunks = body.split(/^(?=\*\*[^*\n]+:\*\*\s*$)/m);
  for (const chunk of chunks) {
    const lead = /^\*\*([^*\n]+):\*\*/.exec(chunk);
    if (!lead) continue;
    const label = lead[1]!.toLowerCase();
    const rest = chunk.slice(lead[0].length);
    if (label.includes("warns against")) {
      out.warnsAgainst = parseBullets(rest).map((b) => b.text);
    } else if (label.includes("teaches")) {
      out.teaches = parseBullets(rest).map((b) => b.text);
    } else if (label.includes("formation challenge")) {
      out.formationChallenge = firstParagraph(rest);
    }
  }
  return out;
}

function parseFormationSignature(body: string): FormationSignature {
  const sig: FormationSignature = { virtues: [], risks: [], formedBy: [] };
  const subs = splitSections("### _\n" + body, 3).slice(1); // skip the synthetic head
  for (const s of subs) {
    const t = s.title.toLowerCase();
    if (t.startsWith("virtues")) sig.virtues = parseBullets(s.body);
    else if (t.startsWith("risks")) sig.risks = parseBullets(s.body);
    else if (t.startsWith("how he was formed")) sig.formedBy = parseBullets(s.body);
  }
  const quote = /^>\s*\*?"?([^\n]+?)"?\*?\s*$/m.exec(body);
  if (quote && sig.virtues.length === 0) sig.quote = stripMarkdown(quote[1]!).replace(/^["“]|["”]$/g, "");
  const practice = /\*\*Core practice:\*\*\s*(.+)/.exec(body);
  if (practice) sig.corePractice = stripMarkdown(practice[1]!);
  return sig;
}

function parseQuickPractice(body: string): Record<AgeRange, string[]> {
  const out: Record<AgeRange, string[]> = { "8-10": [], "11-14": [], "15-18": [] };
  // Accept "**Ages 8-10:**" bold leads or "### Ages 8-10" headings.
  const parts = body.split(/^(?=(?:\*\*|###\s*)Ages\s+\d+-\d+)/m);
  for (const part of parts) {
    const m = /^(?:\*\*|###\s*)Ages\s+(\d+-\d+)/.exec(part);
    if (!m) continue;
    const range = m[1] as AgeRange;
    if (AGE_RANGES.includes(range)) out[range] = parseListItems(part);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Student lessons, parent guide, week plan, research
// ---------------------------------------------------------------------------

const QUESTION_HEADING_RE = /question|provocation|seminar|essay prompt|discussion prompt|reflection/i;

/** Sentences ending in "?" from a block of prose. */
function questionSentences(body: string): string[] {
  const text = stripMarkdown(body.replace(/^>\s?/gm, ""));
  return (text.match(/[^.!?]*\?/g) ?? []).map((q) => q.trim()).filter((q) => q.length > 12);
}

/** Questions from a section: list items, then H3 titles, then bare "?" sentences. */
function questionsIn(section: Section): string[] {
  const items = parseListItems(section.body).filter((i) => i.length > 3);
  if (items.length) return items;
  const h3 = splitSections("### _\n" + section.body, 3)
    .slice(1)
    .map((s) => stripMarkdown(s.title.replace(/^\d+[.)]\s*/, "")))
    .filter((t) => t.includes("?"));
  if (h3.length) return h3;
  return questionSentences(section.body);
}

function parseLesson(path: string, md: string, ageRange: AgeRange): LessonSummary {
  const lines = md.split("\n");
  const title = stripMarkdown((lines[1] ?? "").replace(/^##\s*/, ""));
  const sections = splitSections(md);
  const eq = findSection(sections, "the essential question", "essential question");
  const essentialQuestion = eq ? firstParagraph(eq.body) : undefined;
  const discussionQuestions: string[] = [];
  for (const s of sections) {
    if (!QUESTION_HEADING_RE.test(s.title)) continue;
    discussionQuestions.push(...questionsIn(s));
  }
  return { ageRange, path, title, essentialQuestion, discussionQuestions, wordCount: wordCount(md) };
}

function parseParentGuide(path: string, md: string): ParentGuideSummary {
  const sections = splitSections(md);
  const overviewSec = findSection(sections, "overview", "core formation aim", "what this profile teaches");
  const misc = findSection(sections, "common misconceptions");
  return {
    path,
    overview: overviewSec ? firstParagraph(overviewSec.body) : undefined,
    misconceptions: misc ? parseListItems(misc.body) : [],
    wordCount: wordCount(md),
  };
}

function parseWeekPlan(path: string, md: string): WeekPlanSummary {
  const sections = splitSections(md);
  const overview = findSection(sections, "overview", "week goal");
  return { path, overview: overview ? firstParagraph(overview.body) : undefined, wordCount: wordCount(md) };
}

function tableCell(md: string, label: string): string | undefined {
  const re = new RegExp(`^\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, "m");
  const m = re.exec(md);
  return m ? stripMarkdown(m[1]!) : undefined;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/,|;/)
    .map((v) => v.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean);
}

function parseResearch(path: string, md: string): ResearchSummary {
  const sections = splitSections(md);
  const eq = findSection(sections, "the essential question");
  let essentialQuestion: string | undefined;
  if (eq) {
    // The template puts the question in a blockquote and the answer in the paragraph after it.
    const paras = eq.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const answer = paras.find((p) => !p.startsWith(">"));
    essentialQuestion = answer ? stripMarkdown(answer) : firstParagraph(eq.body);
  }
  const moments = findSection(sections, "defining moments");
  const failures = findSection(sections, "failures and recovery", "failures");
  const wisdom = findSection(sections, "teaching wisdom");
  const tutor = findSection(sections, "for the ai tutor");

  const coreLessons: string[] = [];
  if (wisdom) {
    for (const m of wisdom.body.matchAll(/^\s*\d+\.\s+\*\*([^*]+)\*\*/gm)) coreLessons.push(stripMarkdown(m[1]!));
  }
  const misconceptions: { myth: string; reality: string }[] = [];
  const whenToReference: string[] = [];
  if (tutor) {
    for (const m of tutor.body.matchAll(/\*\*Myth:\*\*\s*(.+?)\s*\n\s*\*\*Reality:\*\*\s*(.+)/g)) {
      misconceptions.push({ myth: stripMarkdown(m[1]!), reality: stripMarkdown(m[2]!) });
    }
    const subs = splitSections("### _\n" + tutor.body, 3).slice(1);
    const when = subs.find((s) => s.title.toLowerCase().startsWith("when to reference"));
    if (when) whenToReference.push(...parseListItems(when.body));
  }
  return {
    path,
    essentialQuestion,
    keyVirtues: splitList(tableCell(md, "Key Virtues")),
    keyFlaws: splitList(tableCell(md, "Key Flaws")),
    famousFor: tableCell(md, "Famous For"),
    definingMoments: moments ? splitSections("### _\n" + moments.body, 3).slice(1).map((s) => stripMarkdown(s.title)) : [],
    failures: failures ? splitSections("### _\n" + failures.body, 3).slice(1).map((s) => stripMarkdown(s.title)) : [],
    coreLessons,
    misconceptions,
    whenToReference,
    wordCount: wordCount(md),
  };
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

const STOP = new Set(
  "the a an and or of to in on at for with by from as is was were be been that this it its his her he she they them their not no but if than then so into out over under what when who whom how why which while never ever all any one two three more most very can could would should may might do does did done has have had things thing get gets got keep keeps just really also about some".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function keywordsFor(p: Omit<Profile, "keywords">): string[] {
  const spineNames = Object.keys(p.spine);
  const bag = new Set<string>();
  const add = (s: string | undefined) => s && tokenize(s).forEach((t) => bag.add(t));
  add(p.name);
  add(p.subtitle);
  add(p.domain);
  add(p.era);
  p.signature.virtues.forEach((b) => add(b.title));
  p.signature.risks.forEach((b) => add(b.title));
  p.research.keyVirtues.forEach(add);
  p.research.keyFlaws.forEach(add);
  p.teaches.forEach(add);
  p.warnsAgainst.forEach(add);
  p.research.coreLessons.forEach(add);
  p.research.whenToReference.forEach(add);
  spineNames.forEach((n) => bag.add(n));
  return [...bag].sort();
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export class ProfileParseError extends Error {}

/** Parse one figure from `<root>/profiles/<slug>` and `<root>/research/<slug>-full.md`. */
export function parseProfile(root: string, slug: string): Profile {
  const seed = FIGURES.find((f) => f.slug === slug) ?? readMeta(root, slug);
  if (!seed) throw new ProfileParseError(`Unknown figure slug: ${slug} (add it to catalog.ts or write profiles/${slug}/meta.json)`);
  const readmePath = `profiles/${slug}/README.md`;
  const readme = readIfExists(join(root, readmePath));
  if (!readme) throw new ProfileParseError(`Missing ${readmePath}`);

  const lines = readme.split("\n");
  const name = stripMarkdown((lines[0] ?? "").replace(/^#\s*/, ""));
  const subtitle = stripMarkdown((lines[1] ?? "").replace(/^##\s*/, ""));
  const sections = splitSections(readme).filter((s) => s.title !== subtitle);
  const rawSections: Record<string, string> = {};
  for (const s of sections) rawSections[s.title] = s.body;

  const story = findSection(sections, "the one-minute story");
  const why = findSection(sections, "why he matters");
  const sig = findSection(sections, "formation signature");
  const quick = findSection(sections, "quick practice");
  const seq = findSection(sections, "in the nova schola sequence");

  const whyParsed = why ? parseWhyHeMatters(why.body) : { teaches: [], warnsAgainst: [] };

  const lessons = {} as Record<AgeRange, LessonSummary>;
  for (const range of AGE_RANGES) {
    const rel = `profiles/${slug}/student-ages-${range}.md`;
    const md = readIfExists(join(root, rel));
    if (!md) throw new ProfileParseError(`Missing ${rel}`);
    lessons[range] = parseLesson(rel, md, range);
  }
  const pgRel = `profiles/${slug}/parent-guide.md`;
  const wpRel = `profiles/${slug}/one-week-lesson.md`;
  const rsRel = `research/${slug}-full.md`;
  const pg = readIfExists(join(root, pgRel));
  const wp = readIfExists(join(root, wpRel));
  const rs = readIfExists(join(root, rsRel));
  if (!pg) throw new ProfileParseError(`Missing ${pgRel}`);
  if (!wp) throw new ProfileParseError(`Missing ${wpRel}`);
  if (!rs) throw new ProfileParseError(`Missing ${rsRel}`);

  const signature = sig ? parseFormationSignature(sig.body) : { virtues: [], risks: [], formedBy: [] };
  const research = parseResearch(rsRel, rs);
  const partial: Omit<Profile, "keywords"> = {
    slug,
    name,
    subtitle,
    born: metaLine(readme, "Born"),
    died: metaLine(readme, "Died"),
    era: metaLine(readme, "Era"),
    eraGroup: seed.eraGroup,
    domain: metaLine(readme, "Domain"),
    day: seed.day,
    readmePath,
    oneMinuteStory: story ? story.body.replace(/\n{3,}/g, "\n\n").trim() : "",
    teaches: whyParsed.teaches,
    warnsAgainst: whyParsed.warnsAgainst,
    formationChallenge: whyParsed.formationChallenge,
    signature,
    quickPractice: quick ? parseQuickPractice(quick.body) : { "8-10": [], "11-14": [], "15-18": [] },
    sequenceNote: seq ? seq.body.trim() : undefined,
    lessons,
    parentGuide: parseParentGuide(pgRel, pg),
    weekPlan: parseWeekPlan(wpRel, wp),
    research,
    spine: virtueSpine({ signature, research }),
    sections: rawSections,
  };
  return { ...partial, keywords: keywordsFor(partial) };
}

/**
 * Figures added after the catalog was written declare themselves with a
 * `profiles/<slug>/meta.json` of the form `{ "eraGroup": "modern", "day": 26 }`.
 */
function readMeta(root: string, slug: string): FigureSeed | undefined {
  const raw = readIfExists(join(root, "profiles", slug, "meta.json"));
  if (!raw) return undefined;
  const meta = JSON.parse(raw) as Partial<FigureSeed>;
  if (!meta.eraGroup || typeof meta.day !== "number") {
    throw new ProfileParseError(`profiles/${slug}/meta.json needs "eraGroup" and "day"`);
  }
  return { slug, eraGroup: meta.eraGroup, day: meta.day };
}

/** Every figure: the catalog, plus any profile directory carrying a meta.json. */
export function listFigureSlugs(root: string): string[] {
  const known = new Set(FIGURES.map((f) => f.slug));
  const dir = join(root, "profiles");
  const extras = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !known.has(d.name) && existsSync(join(dir, d.name, "meta.json")))
        .map((d) => ({ slug: d.name, day: readMeta(root, d.name)!.day }))
        .sort((a, b) => a.day - b.day || a.slug.localeCompare(b.slug))
        .map((d) => d.slug)
    : [];
  return [...FIGURES.map((f) => f.slug), ...extras];
}

/** Parse every figure in the catalog (plus meta.json extras). */
export function parseCorpus(root: string): Corpus {
  const figures = listFigureSlugs(root).map((slug) => parseProfile(root, slug));
  return { schemaVersion: 1, count: figures.length, figures };
}
