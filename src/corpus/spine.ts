/**
 * The virtue spine: six virtues that every life in the library is taught through.
 *
 * The four cardinal virtues (temperance, fortitude, justice, prudence) and the
 * two great-souled virtues of Aristotle's Ethics, book IV (magnanimity,
 * magnificence). Each profile's curated virtue and risk labels are mapped onto
 * the spine by rule, so twenty-five lists become one system: a figure is
 * imitated for a virtue and guarded against for the vice that offends it.
 */
import type { Profile } from "./types.js";

export type SpineVirtue = "temperance" | "fortitude" | "justice" | "prudence" | "magnanimity" | "magnificence";

export const SPINE_ORDER: readonly SpineVirtue[] = ["temperance", "fortitude", "justice", "prudence", "magnanimity", "magnificence"];

export interface SpineSpec {
  virtue: SpineVirtue;
  greek: string;
  latin: string;
  /** What the virtue governs. */
  definition: string;
  /** The question the tutor asks about a life, or a student, under this virtue. */
  question: string;
}

export const SPINE: Record<SpineVirtue, SpineSpec> = {
  temperance: {
    virtue: "temperance",
    greek: "sophrosyne",
    latin: "temperantia",
    definition: "Command of pleasure, impulse and appetite; the self ruled before anything else is.",
    question: "What does he refuse himself, and what does he fail to refuse?",
  },
  fortitude: {
    virtue: "fortitude",
    greek: "andreia",
    latin: "fortitudo",
    definition: "Facing adversity, and increasing adversity, without surrender; endurance in long work.",
    question: "What does he hold under pressure that others let go?",
  },
  justice: {
    virtue: "justice",
    greek: "dikaiosyne",
    latin: "iustitia",
    definition: "Giving each his due: duty, fidelity, truthfulness, service to the common good.",
    question: "Whom does he serve, and whom does he fail?",
  },
  prudence: {
    virtue: "prudence",
    greek: "phronesis",
    latin: "prudentia",
    definition: "Practical wisdom: seeing truly, judging rightly, choosing the means that fit the end.",
    question: "What does he see that others miss, and where is his judgment blind?",
  },
  magnanimity: {
    virtue: "magnanimity",
    greek: "megalopsychia",
    latin: "magnanimitas",
    definition: "Greatness of soul: claiming great things because one is worthy of them, and knowing the measure.",
    question: "What great thing does he reach for, and where does reaching become vanity?",
  },
  magnificence: {
    virtue: "magnificence",
    greek: "megaloprepeia",
    latin: "magnificentia",
    definition: "Great works and great expenditure for the public good: the school, the city, the library, the law.",
    question: "What does he build that outlives him, and for whom?",
  },
};

interface Rule {
  virtue: SpineVirtue;
  pattern: RegExp;
}

/** Virtue labels -> the virtue they instantiate. Order matters only for readability; all matches count. */
const VIRTUE_RULES: Rule[] = [
  { virtue: "temperance", pattern: /\b(discipline|disciplined|restraint|self-command|self-examination|humility|humble|teachab|moderation|temperance|sobriety|concentration|exactness|composure|equanimity|meditation|gratitude|peaceable)/i },
  { virtue: "fortitude", pattern: /\b(courage|courageous|boldness|resilien|persever|persistence|persistent|endur|patience|patient|industry|industrious|energy|interior freedom|composure under|equanimity under|conviction)/i },
  { virtue: "justice", pattern: /\b(justice|duty|service|fairness|fair|fidelity|faithful|loyal|civic|public|honesty|integrity|consistency between word and deed|piety|pious|reverence|repentance|charity|humane|respect for|merit|defense of conscience|devotion to a teacher)/i },
  { virtue: "prudence", pattern: /\b(prudence|prudent|practical wisdom|judgment|observation|method|methodical|clarity|systematic|mathematical|empirical|source discipline|textual care|strategic|foresight|reframing|synthesis|integration|curiosity|love of learning|seriousness|encyclopedic|imagination|range|eloquence|craftsmanship|exact)/i },
  { virtue: "magnanimity", pattern: /\b(magnanimity|magnanimous|pothos|ambition|vocation|aspiration|friendship with excellence|imitation of a living model|intellectual independence|intellectual courage)/i },
  { virtue: "magnificence", pattern: /\b(magnificence|institution|institutional|patron|stewardship|building|cultivation|endow|founding)/i },
];

/** Risk labels -> the virtue they offend (the guard side). */
const RISK_RULES: Rule[] = [
  { virtue: "temperance", pattern: /\b(wrath|drunk|sensual|impulsiv|restless|addiction|indulgence|excess|impatien|no stopping|overreach|overextension|bitterness|gloom|control|overcontrol|severity|harshness|sharp satire|combative|aggression|coercive|ruthless)/i },
  { virtue: "fortitude", pattern: /\b(cowardice|caution|appease|conflict fatigue|indecision|defensiveness|dependency|dependence|escape|rootless|inflexib|secrecy)/i },
  { virtue: "justice", pattern: /\b(tyranny|moral compromise|moral contradiction|factional|coldness|emotional distance|absentee|neglect of family|tactless|partisan|suspicion|personalism|dynastic|idolatry|blindness|elitism|distrust|isolation|unworthy)/i },
  { virtue: "prudence", pattern: /\b(na[iï]vet|overestimation|abstraction|over-system|systematiz|rigidity|excessive doubt|utopian|trauma distortion|confusing|self-deception|aesthetic|scattered|perfectionism|premature|imprudence|romantic|lecture habit|mechanization|bad models|showiness|financial neglect|limits of moderation|cynicism)/i },
  { virtue: "magnanimity", pattern: /\b(pride|hybris|hubris|vanity|vain|status|glory|ambition|overconfidence)/i },
  { virtue: "magnificence", pattern: /\b(vanity of magnificence|cultural neglect)/i },
];

/** Exact-label overrides (lower-cased) for cases the patterns get wrong. */
const VIRTUE_OVERRIDES: Record<string, SpineVirtue[]> = {
  "patience in building": ["fortitude", "magnificence"],
  "institution-building": ["magnificence", "prudence"],
  "institutional imagination": ["magnificence", "prudence"],
  "cultural stewardship": ["magnificence", "justice"],
  "intellectual stewardship": ["magnificence", "justice"],
  "intellectual courage": ["fortitude", "magnanimity"],
  "encyclopedic ambition": ["magnanimity", "prudence"],
  cultivation: ["magnificence"],
  pothos: ["magnanimity"],
  "educational seriousness": ["magnificence", "prudence"],
  "love of learning": ["prudence"],
  "restraint of power": ["temperance", "justice"],
  "duty over preference": ["justice", "temperance"],
  "learned piety": ["justice", "prudence"],
  "humane discipline": ["justice", "temperance"],
  "composure under injustice": ["fortitude", "temperance"],
  "equanimity under attack": ["fortitude", "temperance"],
  "commitment to truth over comfort": ["justice", "fortitude"],
};

const RISK_OVERRIDES: Record<string, SpineVirtue[]> = {
  "vanity of magnificence": ["magnificence", "magnanimity"],
  "financial neglect": ["magnificence", "prudence"],
  "no succession": ["magnificence", "prudence"],
  "patron dependency": ["fortitude", "justice"],
  "dependence on patrons": ["fortitude", "justice"],
  "courtly ambition": ["magnanimity", "fortitude"],
  "status hunger": ["magnanimity", "temperance"],
  "attachment to status": ["magnanimity", "temperance"],
  "glory addiction": ["magnanimity", "temperance"],
  "indulgence of the unworthy": ["justice", "fortitude"],
  "imperial blindness": ["justice", "prudence"],
  "cultural blindness": ["prudence", "justice"],
  "romantic war-language": ["prudence", "temperance"],
  "the lecture habit": ["prudence"],
  "the limits of moderation": ["prudence", "fortitude"],
  "absentee fatherhood": ["justice"],
  "excessive gloominess": ["fortitude", "temperance"],
  isolation: ["justice", "temperance"],
  control: ["temperance", "justice"],
  overcontrol: ["temperance", "justice"],
  indirectness: ["fortitude"],
  "the real ambiguity of his influence on alcibiades and critias": ["prudence", "justice"],
  "perhaps a too-comfortable accommodation with macedonian power at the end": ["fortitude", "justice"],
};

function classify(label: string, rules: Rule[], overrides: Record<string, SpineVirtue[]>): SpineVirtue[] {
  const key = label.toLowerCase().trim();
  const forced = overrides[key];
  if (forced) return forced;
  const hits = new Set<SpineVirtue>();
  for (const r of rules) if (r.pattern.test(key)) hits.add(r.virtue);
  return SPINE_ORDER.filter((v) => hits.has(v));
}

/** Which spine virtues a curated virtue label instantiates (possibly several; possibly none). */
export function classifyVirtue(label: string): SpineVirtue[] {
  return classify(label, VIRTUE_RULES, VIRTUE_OVERRIDES);
}

/** Which spine virtues a curated risk label offends. */
export function classifyRisk(label: string): SpineVirtue[] {
  return classify(label, RISK_RULES, RISK_OVERRIDES);
}

export interface SpineEntry {
  /** Virtue labels from the profile that instantiate this virtue. */
  imitate: string[];
  /** Risk labels from the profile that offend this virtue. */
  guard: string[];
}

export type VirtueSpine = Partial<Record<SpineVirtue, SpineEntry>>;

/** Map a profile's curated labels onto the spine. Falls back to the research metadata for quote-led profiles. */
export function virtueSpine(p: Pick<Profile, "signature" | "research">): VirtueSpine {
  const virtues = p.signature.virtues.length ? p.signature.virtues.map((b) => b.title) : p.research.keyVirtues;
  const risks = p.signature.risks.length ? p.signature.risks.map((b) => b.title) : p.research.keyFlaws;
  const spine: VirtueSpine = {};
  const entry = (v: SpineVirtue) => (spine[v] ??= { imitate: [], guard: [] });
  for (const label of virtues) for (const v of classifyVirtue(label)) entry(v).imitate.push(label);
  for (const label of risks) for (const v of classifyRisk(label)) entry(v).guard.push(label);
  return spine;
}

/** Labels the rules do not place anywhere, so the mapping can be reviewed when profiles change. */
export function unmappedLabels(p: Pick<Profile, "signature" | "research">): { virtues: string[]; risks: string[] } {
  const virtues = p.signature.virtues.length ? p.signature.virtues.map((b) => b.title) : p.research.keyVirtues;
  const risks = p.signature.risks.length ? p.signature.risks.map((b) => b.title) : p.research.keyFlaws;
  return {
    virtues: virtues.filter((l) => classifyVirtue(l).length === 0),
    risks: risks.filter((l) => classifyRisk(l).length === 0),
  };
}

export interface SpineIndexEntry {
  slug: string;
  name: string;
  imitate: string[];
  guard: string[];
}

/** For each spine virtue, the figures that exemplify it or warn against its vice, in sequence order. */
export function spineIndex(figures: Pick<Profile, "slug" | "name" | "day" | "spine">[]): Record<SpineVirtue, SpineIndexEntry[]> {
  const index = Object.fromEntries(SPINE_ORDER.map((v) => [v, [] as SpineIndexEntry[]])) as Record<SpineVirtue, SpineIndexEntry[]>;
  for (const f of [...figures].sort((a, b) => a.day - b.day)) {
    for (const v of SPINE_ORDER) {
      const e = f.spine[v];
      if (e && (e.imitate.length || e.guard.length)) index[v].push({ slug: f.slug, name: f.name, imitate: e.imitate, guard: e.guard });
    }
  }
  return index;
}

export function isSpineVirtue(value: string): value is SpineVirtue {
  return (SPINE_ORDER as readonly string[]).includes(value);
}
