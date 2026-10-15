/**
 * Lightweight, dependency-free retrieval over the corpus.
 *
 * This is deliberately not a vector index: 25 figures with curated virtue /
 * risk vocab are small enough that token overlap with a little prefix
 * matching finds the right exemplum, and the tutor model does the rest.
 */
import type { SpineVirtue } from "./spine.js";
import type { AgeRange, Corpus, EraGroup, Profile } from "./types.js";
import { tokenize } from "./parse.js";

export interface ExemplumQuery {
  /** Free text: a virtue, a struggle, a subject, a situation. */
  query?: string;
  /** A virtue to imitate, e.g. "courage", "patience". */
  virtue?: string;
  /** A struggle or vice to address, e.g. "procrastination", "pride", "fear of failure". */
  struggle?: string;
  era?: EraGroup;
  domain?: string;
  /** Restrict to figures that exemplify (or warn against) one spine virtue. */
  spine?: SpineVirtue;
  limit?: number;
}

export interface ExemplumHit {
  slug: string;
  name: string;
  subtitle: string;
  eraGroup: EraGroup;
  domain: string;
  score: number;
  /** The lines from the profile that matched, so the tutor can cite them. */
  evidence: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolve a slug or a loose name ("Marcus", "the great", "da Vinci") to a profile. */
export function findProfile(corpus: Corpus, ref: string): Profile | undefined {
  const key = normalize(ref);
  if (!key) return undefined;
  const bySlug = corpus.figures.find((f) => f.slug === key.replace(/ /g, "-"));
  if (bySlug) return bySlug;
  const exact = corpus.figures.find((f) => normalize(f.name) === key);
  if (exact) return exact;
  const ALIASES: Record<string, string> = {
    "da vinci": "leonardo",
    "leonardo da vinci": "leonardo",
    marcus: "marcus-aurelius",
    aurelius: "marcus-aurelius",
    aquinas: "thomas-aquinas",
    descartes: "rene-descartes",
    newton: "isaac-newton",
    washington: "george-washington",
    jefferson: "thomas-jefferson",
    napoleon: "napoleon-bonaparte",
    churchill: "winston-churchill",
    frederick: "frederick-the-great",
    lorenzo: "lorenzo-de-medici",
    medici: "lorenzo-de-medici",
    "alexander the great": "alexander",
  };
  const alias = ALIASES[key];
  if (alias) return corpus.figures.find((f) => f.slug === alias);
  const keyTokens = key.split(" ");
  const partial = corpus.figures.filter((f) => {
    const n = normalize(f.name);
    return keyTokens.every((t) => n.includes(t)) || n.split(" ").some((w) => keyTokens.includes(w));
  });
  return partial.length === 1 ? partial[0] : partial.find((f) => normalize(f.name).startsWith(key));
}

function matches(term: string, token: string): boolean {
  if (term === token) return true;
  // Prefix stem so "courageous" finds "courage" and "patient" finds "patience".
  const stem = Math.min(term.length, token.length, 5);
  return stem >= 4 && term.slice(0, stem) === token.slice(0, stem);
}

/**
 * Student language -> the curated vocabulary of the profiles. A child says
 * "I keep quitting"; the profiles say persistence, finishing, stopping point.
 */
const SYNONYMS: Record<string, string[]> = {
  quit: ["persistence", "perseverance", "finishing", "endurance", "stopping"],
  quitting: ["persistence", "perseverance", "finishing", "endurance", "stopping"],
  persist: ["perseverance", "endurance", "patience"],
  persevere: ["perseverance", "endurance", "patience"],
  fear: ["courage", "boldness"],
  afraid: ["courage", "boldness"],
  scared: ["courage"],
  brave: ["courage"],
  bravery: ["courage"],
  lazy: ["discipline", "diligence", "habit", "work"],
  laziness: ["discipline", "diligence", "habit"],
  procrastination: ["discipline", "finishing", "scattered"],
  procrastinate: ["discipline", "finishing", "scattered"],
  bored: ["curiosity", "observation", "wonder"],
  boring: ["curiosity", "wonder"],
  lying: ["honesty", "truth", "integrity"],
  lie: ["honesty", "truth"],
  lies: ["honesty", "truth"],
  cheating: ["honesty", "integrity"],
  angry: ["wrath", "temper", "anger"],
  anger: ["wrath", "temper"],
  temper: ["wrath", "anger"],
  proud: ["pride", "hubris", "humility"],
  arrogant: ["pride", "hubris", "humility"],
  arrogance: ["pride", "hubris"],
  humble: ["humility"],
  distracted: ["focus", "attention", "scattered", "concentration"],
  distraction: ["focus", "attention", "scattered"],
  focus: ["attention", "concentration"],
  shy: ["speech", "rhetoric", "confidence", "voice"],
  failure: ["recovery", "defeat", "resilience"],
  failed: ["recovery", "defeat", "resilience"],
  failing: ["recovery", "defeat", "resilience"],
  mistakes: ["failure", "recovery"],
  stubborn: ["obstinacy", "rigidity", "pride"],
  friends: ["friendship", "loyalty", "cohort"],
  friend: ["friendship", "loyalty"],
  loyalty: ["friendship"],
  money: ["wealth", "patronage", "debt"],
  leader: ["leadership", "command"],
  leadership: ["command", "front"],
  study: ["learning", "memory", "discipline"],
  studying: ["learning", "memory", "discipline"],
  memorize: ["memory"],
  memorizing: ["memory"],
  questions: ["questioning", "inquiry"],
  question: ["questioning", "inquiry"],
  duty: ["service", "obligation"],
  power: ["ambition", "rule", "authority"],
  ambition: ["ambitious", "pothos", "drive"],
  patience: ["patient", "waiting"],
  wait: ["patience"],
  waiting: ["patience"],
  observe: ["observation", "looking"],
  look: ["observation"],
  looking: ["observation"],
  write: ["writing", "rhetoric", "expression"],
  writing: ["rhetoric", "expression"],
  speak: ["speech", "rhetoric", "oratory"],
  speaking: ["speech", "rhetoric", "oratory"],
  alone: ["solitude", "loneliness"],
  lonely: ["solitude", "friendship"],
};

/** Query terms plus their curated-vocabulary synonyms. */
export function expandTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const t of tokenize(text)) {
    terms.add(t);
    for (const syn of SYNONYMS[t] ?? []) terms.add(syn);
  }
  return terms;
}

/** Rank figures by how well their virtues, risks and lessons match the query. */
export function findExempla(corpus: Corpus, q: ExemplumQuery): ExemplumHit[] {
  const terms = new Set<string>();
  for (const s of [q.query, q.virtue, q.struggle]) if (s) expandTerms(s).forEach((t) => terms.add(t));
  const limit = q.limit ?? 5;
  const hits: ExemplumHit[] = [];

  for (const f of corpus.figures) {
    if (q.era && f.eraGroup !== q.era) continue;
    if (q.domain && !normalize(f.domain).includes(normalize(q.domain))) continue;
    const spineEntry = q.spine ? f.spine[q.spine] : undefined;
    if (q.spine && !spineEntry) continue;

    let score = 0;
    const evidence: string[] = [];
    const consider = (line: string, weight: number) => {
      const toks = tokenize(line);
      let hit = 0;
      for (const term of terms) if (toks.some((t) => matches(term, t))) hit++;
      if (hit > 0) {
        score += hit * weight;
        if (evidence.length < 6) evidence.push(line);
      }
    };
    // Weight curated vocab higher than prose.
    f.signature.virtues.forEach((b) => consider(b.text, q.struggle && !q.virtue ? 2 : 4));
    f.signature.risks.forEach((b) => consider(b.text, q.virtue && !q.struggle ? 2 : 4));
    f.research.keyVirtues.forEach((v) => consider(v, 3));
    f.research.keyFlaws.forEach((v) => consider(v, 3));
    f.teaches.forEach((t) => consider(t, 2));
    f.warnsAgainst.forEach((t) => consider(t, 2));
    f.research.whenToReference.forEach((t) => consider(t, 2));
    f.research.coreLessons.forEach((t) => consider(t, 1));
    consider(f.subtitle + " " + f.domain, 1);

    if (spineEntry) {
      // The spine is curated: a figure listed under the virtue outranks keyword matches.
      score += 3 * (spineEntry.imitate.length + spineEntry.guard.length);
      for (const l of spineEntry.imitate) if (evidence.length < 6) evidence.push(`${q.spine}: imitate — ${l}`);
      for (const l of spineEntry.guard) if (evidence.length < 6) evidence.push(`${q.spine}: guard against — ${l}`);
    }
    if (terms.size === 0 && score === 0) score = 1; // filter-only query: return everyone matching filters
    if (score > 0) {
      hits.push({ slug: f.slug, name: f.name, subtitle: f.subtitle, eraGroup: f.eraGroup, domain: f.domain, score, evidence });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

/** Pick the lesson age range for a student age (clamped to the 8-18 span the lessons cover). */
export function ageRangeFor(age: number): AgeRange {
  if (age <= 10) return "8-10";
  if (age <= 14) return "11-14";
  return "15-18";
}
