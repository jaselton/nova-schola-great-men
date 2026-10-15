import type { EraGroup } from "./types.js";

/**
 * The 25 figures in Nova Schola sequence order (Day 1 = Leonardo, the first
 * profile committed; the README groups them by era instead).
 */
export interface FigureSeed {
  slug: string;
  eraGroup: EraGroup;
  day: number;
}

export const FIGURES: readonly FigureSeed[] = [
  { slug: "leonardo", eraGroup: "renaissance", day: 1 },
  { slug: "alexander", eraGroup: "ancient", day: 2 },
  { slug: "plato", eraGroup: "ancient", day: 3 },
  { slug: "aristotle", eraGroup: "ancient", day: 4 },
  { slug: "marcus-aurelius", eraGroup: "ancient", day: 5 },
  { slug: "socrates", eraGroup: "ancient", day: 6 },
  { slug: "isocrates", eraGroup: "ancient", day: 7 },
  { slug: "cicero", eraGroup: "ancient", day: 8 },
  { slug: "quintilian", eraGroup: "ancient", day: 9 },
  { slug: "augustine", eraGroup: "medieval", day: 10 },
  { slug: "boethius", eraGroup: "medieval", day: 11 },
  { slug: "charlemagne", eraGroup: "medieval", day: 12 },
  { slug: "alcuin", eraGroup: "medieval", day: 13 },
  { slug: "anselm", eraGroup: "medieval", day: 14 },
  { slug: "thomas-aquinas", eraGroup: "renaissance", day: 15 },
  { slug: "lorenzo-de-medici", eraGroup: "renaissance", day: 16 },
  { slug: "erasmus", eraGroup: "renaissance", day: 17 },
  { slug: "galileo", eraGroup: "renaissance", day: 18 },
  { slug: "rene-descartes", eraGroup: "renaissance", day: 19 },
  { slug: "isaac-newton", eraGroup: "renaissance", day: 20 },
  { slug: "frederick-the-great", eraGroup: "modern", day: 21 },
  { slug: "george-washington", eraGroup: "modern", day: 22 },
  { slug: "thomas-jefferson", eraGroup: "modern", day: 23 },
  { slug: "napoleon-bonaparte", eraGroup: "modern", day: 24 },
  { slug: "winston-churchill", eraGroup: "modern", day: 25 },
];

export const ERA_LABELS: Record<EraGroup, string> = {
  ancient: "Ancient",
  medieval: "Medieval",
  renaissance: "Renaissance & Early Modern",
  modern: "Modern",
};
