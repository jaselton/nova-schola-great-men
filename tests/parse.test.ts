import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIGURES } from "../src/corpus/catalog.js";
import { REPO_ROOT } from "../src/corpus/index.js";
import { parseBullets, parseCorpus, parseProfile, splitSections, stripMarkdown } from "../src/corpus/parse.js";
import { AGE_RANGES } from "../src/corpus/types.js";

const corpus = parseCorpus(REPO_ROOT);

describe("markdown helpers", () => {
  it("splits H2 sections and keeps bodies", () => {
    const s = splitSections("# T\n## A\nbody a\n### sub\nmore\n## B\nbody b\n");
    expect(s.map((x) => x.title)).toEqual(["A", "B"]);
    expect(s[0]!.body).toContain("### sub");
    expect(s[1]!.body).toBe("body b");
  });
  it("parses bold-lead bullets", () => {
    const b = parseBullets("- **Courage** — never asked men to go where he would not\n- plain item\n- ***Pothos*** — longing");
    expect(b[0]).toEqual({ title: "Courage", detail: "never asked men to go where he would not", text: "Courage — never asked men to go where he would not" });
    expect(b[1]!.title).toBe("plain item");
    expect(b[2]!.title).toBe("Pothos");
  });
  it("strips emphasis and links", () => {
    expect(stripMarkdown("see [Plutarch](x.md) and *Lives* with **force** and `code`")).toBe("see Plutarch and Lives with force and code");
  });
});

describe("corpus", () => {
  it("parses all 25 figures in sequence order", () => {
    expect(corpus.count).toBe(25);
    expect(corpus.figures.map((f) => f.day)).toEqual([...Array(25)].map((_, i) => i + 1));
    expect(corpus.figures.map((f) => f.slug)).toEqual(FIGURES.map((f) => f.slug));
  });

  it("extracts the common fields for every figure", () => {
    for (const f of corpus.figures) {
      expect(f.name, f.slug).toBeTruthy();
      expect(f.subtitle, f.slug).toBeTruthy();
      expect(f.born, f.slug).toBeTruthy();
      expect(f.died, f.slug).toBeTruthy();
      expect(f.era, f.slug).toBeTruthy();
      expect(f.domain, f.slug).toBeTruthy();
      expect(f.oneMinuteStory.split(/\s+/).length, f.slug).toBeGreaterThan(80);
      expect(f.teaches.length, f.slug).toBeGreaterThanOrEqual(3);
      for (const r of AGE_RANGES) {
        expect(f.lessons[r].title, `${f.slug} ${r}`).toBeTruthy();
        expect(f.lessons[r].wordCount, `${f.slug} ${r}`).toBeGreaterThan(300);
        expect(f.lessons[r].discussionQuestions.length, `${f.slug} ${r}`).toBeGreaterThanOrEqual(0);
      }
      expect(f.parentGuide.wordCount, f.slug).toBeGreaterThan(300);
      expect(f.weekPlan.wordCount, f.slug).toBeGreaterThan(300);
      expect(f.research.wordCount, f.slug).toBeGreaterThan(1000);
      expect(f.keywords.length, f.slug).toBeGreaterThan(40);
      expect(Object.keys(f.sections), f.slug).toContain("The One-Minute Story");
    }
  });

  it("handles both formation-signature shapes", () => {
    const standard = corpus.figures.filter((f) => f.signature.virtues.length >= 3 && f.signature.risks.length >= 3);
    const quoteLed = corpus.figures.filter((f) => f.signature.quote && f.signature.corePractice);
    expect(standard.length).toBe(22);
    expect(quoteLed.map((f) => f.slug).sort()).toEqual(["cicero", "isocrates", "socrates"]);
  });

  it("extracts Alexander precisely", () => {
    const a = parseProfile(REPO_ROOT, "alexander");
    expect(a.name).toBe("Alexander the Great");
    expect(a.subtitle).toBe("The Engineered King and the Limits of Formation");
    expect(a.born).toMatch(/356 BCE/);
    expect(a.eraGroup).toBe("ancient");
    expect(a.day).toBe(2);
    expect(a.signature.virtues[0]!.title).toBe("Courage in the front rank");
    expect(a.signature.risks.map((r) => r.title)).toContain("Wrath");
    expect(a.signature.formedBy.length).toBe(7);
    expect(a.teaches.length).toBe(5);
    expect(a.warnsAgainst.length).toBe(4);
    expect(a.quickPractice["8-10"].length).toBe(4);
    expect(a.lessons["8-10"].title).toBe("The Boy Who Tamed the Shadow-Horse");
    expect(a.lessons["11-14"].essentialQuestion).toMatch(/made.*great/i);
    expect(a.research.keyVirtues).toContain("Courage");
    expect(a.research.definingMoments.length).toBe(5);
    expect(a.research.misconceptions.length).toBeGreaterThan(0);
    expect(a.research.coreLessons.length).toBe(5);
  });

  it("extracts questions from heading variants (Cicero's H3 questions, Marcus' prose question)", () => {
    const cicero = corpus.figures.find((f) => f.slug === "cicero")!;
    expect(cicero.lessons["11-14"].discussionQuestions[0]).toMatch(/Catiline/);
    const marcus = corpus.figures.find((f) => f.slug === "marcus-aurelius")!;
    expect(marcus.lessons["8-10"].discussionQuestions[0]).toMatch(/\?$/);
  });

  it("committed data/great-men.json is current", () => {
    const committed = JSON.parse(readFileSync(join(REPO_ROOT, "data", "great-men.json"), "utf8"));
    expect(committed).toEqual(corpus);
  });
});
