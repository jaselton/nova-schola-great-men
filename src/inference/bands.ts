/**
 * Developmental bands - Layer 2 of the Trivium architecture.
 *
 * These are parameters, not personas: the student always meets one tutor.
 * The band changes tone, pacing, abstraction, which student lesson is
 * retrieved, and how much reasoning effort the model spends.
 */
import type { AgeRange } from "../corpus/types.js";
import type { Effort } from "./models.js";

export type Band = "foundational" | "formative" | "dialectical" | "integrative";

export interface BandSpec {
  band: Band;
  label: string;
  /** Inclusive age span the band is tuned for. */
  ages: [number, number];
  /** Which of the three shipped student lessons to retrieve for this band. */
  lessonRange: AgeRange;
  /** Reasoning effort for the tutor model. Younger bands need warmth and speed, not depth. */
  effort: Effort;
  /** The calibration text injected into the system prompt. */
  calibration: string;
}

export const BANDS: Record<Band, BandSpec> = {
  foundational: {
    band: "foundational",
    label: "Foundational",
    ages: [5, 8],
    lessonRange: "8-10",
    effort: "low",
    calibration: `Developmental band: FOUNDATIONAL (about ages 5-8).
- High warmth and strong encouragement, but praise only real effort.
- Concrete examples and vivid stories; short interaction loops (one idea, one question).
- Heroic narratives: young Alexander and Bucephalus, Leonardo's notebooks, Marcus sleeping on the floor.
- Simple virtues by name: courage, honesty, kindness, patience, hard work.
- Grammar mode dominant, with narrative Rhetoric. Keep logic implicit.
- Sentences short. Vocabulary plain. Define any big word the moment you use it.
- Use the ages 8-10 student lesson when you retrieve one, and follow its "what to leave for later" guidance from the parent guide: no graphic violence, no adult vice in detail.`,
  },
  formative: {
    band: "formative",
    label: "Formative",
    ages: [9, 13],
    lessonRange: "11-14",
    effort: "medium",
    calibration: `Developmental band: FORMATIVE (about ages 9-13).
- Guided questioning begins: ask before telling, but do not stall a student who needs a fact first.
- Pattern discovery: help them see the move (reframing, cohort, deliberate formation) across lives.
- Moral clarity through exempla; name the virtue and the risk in the same breath.
- Early argumentation: "Can you convince me?" "What would the other side say?"
- Grammar and Logic balanced; introduce simplified primary sources (a line of Plutarch, a sentence of Marcus).
- Use the ages 11-14 student lesson when you retrieve one. Complicate the story a little; do not dwell on the darkest episodes.`,
  },
  dialectical: {
    band: "dialectical",
    label: "Dialectical",
    ages: [14, 18],
    lessonRange: "15-18",
    effort: "high",
    calibration: `Developmental band: DIALECTICAL (about ages 14-18).
- Adversarial logic: "Argue the opposite." Present competing frameworks and make the student choose and defend.
- Primary sources required: send them to Plutarch, Arrian, the Meditations, the Confessions, the letters, the speeches.
- Writing rigor demanded: thesis, evidence, counter-argument, judgment. Mark vague claims.
- Logic mode dominant, Rhetoric rising. Expect and reward intellectual courage.
- Use the ages 15-18 student lesson when you retrieve one. Nothing is off limits, but everything must be judged.`,
  },
  integrative: {
    band: "integrative",
    label: "Integrative",
    ages: [19, 120],
    lessonRange: "15-18",
    effort: "high",
    calibration: `Developmental band: INTEGRATIVE (adults and advanced students).
- Cross-domain synthesis: connect the lives to the student's own work, institutions and decisions.
- Philosophical depth; original production expected (an essay, a plan, a lesson they will teach).
- Full trivium integration; treat the student as an intellectual peer in training.
- The ages 15-18 lessons are the deepest shipped material; go beyond them to the research essays and bibliographies.`,
  },
};

export const BAND_ORDER: readonly Band[] = ["foundational", "formative", "dialectical", "integrative"];

export function isBand(value: string): value is Band {
  return (BAND_ORDER as readonly string[]).includes(value);
}

/** Map an age to its band. Ages below 5 are treated as foundational. */
export function bandForAge(age: number): Band {
  if (!Number.isFinite(age) || age <= 8) return "foundational";
  if (age <= 13) return "formative";
  if (age <= 18) return "dialectical";
  return "integrative";
}
