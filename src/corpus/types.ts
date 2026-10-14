/**
 * Structured representation of the Great Men corpus.
 *
 * Everything here is derived from the markdown under `profiles/` and
 * `research/` by `parse.ts`, and serialized to `data/great-men.json` by
 * `build.ts`. The inference layer consumes these types; the markdown stays
 * the source of truth.
 */

export type EraGroup = "ancient" | "medieval" | "renaissance" | "modern";

/** The three student-lesson age ranges shipped with every profile. */
export type AgeRange = "8-10" | "11-14" | "15-18";

export const AGE_RANGES: readonly AgeRange[] = ["8-10", "11-14", "15-18"];

/** A markdown bullet, split into a bold lead (if any) and the rest. */
export interface Bullet {
  /** The bold lead of the bullet, e.g. "Courage in the front rank". */
  title: string;
  /** Text after the lead, e.g. "never asked men to go where he would not". */
  detail: string;
  /** The whole bullet line with markdown emphasis stripped. */
  text: string;
}

export interface FormationSignature {
  /** "Virtues (What to Imitate)" */
  virtues: Bullet[];
  /** "Risks (What to Guard Against)" */
  risks: Bullet[];
  /** "How He Was Formed" */
  formedBy: Bullet[];
  /** Epigraph used by the three profiles (Socrates, Isocrates, Cicero) that lead with a quote. */
  quote?: string;
  /** "Core practice" paragraph used by those same three profiles. */
  corePractice?: string;
}

export interface LessonSummary {
  ageRange: AgeRange;
  /** Repo-relative path, e.g. profiles/alexander/student-ages-8-10.md */
  path: string;
  /** The lesson's H2 subtitle, e.g. "The Boy Who Tamed the Shadow-Horse". */
  title: string;
  essentialQuestion?: string;
  /** Every numbered or bulleted question found under a "Discussion Questions"-style heading. */
  discussionQuestions: string[];
  wordCount: number;
}

export interface ParentGuideSummary {
  path: string;
  overview?: string;
  /** Myth/Reality or "Common Misconceptions" bullets, when present. */
  misconceptions: string[];
  wordCount: number;
}

export interface WeekPlanSummary {
  path: string;
  overview?: string;
  wordCount: number;
}

export interface ResearchSummary {
  path: string;
  essentialQuestion?: string;
  keyVirtues: string[];
  keyFlaws: string[];
  famousFor?: string;
  /** H3 titles under "Defining Moments". */
  definingMoments: string[];
  /** H3 titles under "Failures and Recovery". */
  failures: string[];
  /** Bold titles of the numbered "Core Lessons". */
  coreLessons: string[];
  /** Myth -> Reality pairs from "Common Misconceptions to Correct". */
  misconceptions: { myth: string; reality: string }[];
  /** "When to Reference This Figure" bullets from the "For the AI Tutor" section. */
  whenToReference: string[];
  wordCount: number;
}

export interface Profile {
  slug: string;
  /** Display name from the README H1, e.g. "Alexander the Great". */
  name: string;
  /** README H2 subtitle, e.g. "The Engineered King and the Limits of Formation". */
  subtitle: string;
  born: string;
  died: string;
  /** Free-text era line from the README, e.g. "Ancient (Classical -> Hellenistic)". */
  era: string;
  eraGroup: EraGroup;
  domain: string;
  /** Position in the Nova Schola 25-day sequence (1 = Leonardo). */
  day: number;
  /** Repo-relative path to the profile README. */
  readmePath: string;
  oneMinuteStory: string;
  /** "X teaches:" bullets from "Why He Matters for Your Child". */
  teaches: string[];
  /** "But also warns against:" bullets. */
  warnsAgainst: string[];
  /** "The formation challenge X poses:" paragraph, when present. */
  formationChallenge?: string;
  signature: FormationSignature;
  /** Quick practice ideas keyed by age range (may be empty for a range). */
  quickPractice: Record<AgeRange, string[]>;
  /** "In the Nova Schola Sequence" prose, when present. */
  sequenceNote?: string;
  lessons: Record<AgeRange, LessonSummary>;
  parentGuide: ParentGuideSummary;
  weekPlan: WeekPlanSummary;
  research: ResearchSummary;
  /** Raw README sections keyed by H2 title, markdown preserved, for verbatim lookup. */
  sections: Record<string, string>;
  /** Lower-cased search terms drawn from virtues, risks, lessons, domain and subtitle. */
  keywords: string[];
}

export interface Corpus {
  /** Bumped when the JSON shape changes. */
  schemaVersion: 1;
  /** Number of figures (25 at v0.2). */
  count: number;
  figures: Profile[];
}
