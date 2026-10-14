import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus/index.js";
import { findExempla } from "../src/corpus/search.js";
import { classifyRisk, classifyVirtue, SPINE_ORDER, spineIndex, unmappedLabels, virtueSpine } from "../src/corpus/spine.js";
import { buildSystemPrompt, spineDigest } from "../src/inference/prompt.js";
import { makeTutorTools } from "../src/inference/tools.js";

const corpus = loadCorpus();

describe("virtue spine", () => {
  it("classifies curated labels", () => {
    expect(classifyVirtue("Courage in the front rank")).toEqual(["fortitude"]);
    expect(classifyVirtue("Restraint of power")).toEqual(["temperance", "justice"]);
    expect(classifyVirtue("Magnanimity")).toEqual(["magnanimity"]);
    expect(classifyVirtue("Institution-building")).toEqual(["magnificence", "prudence"]);
    expect(classifyRisk("Wrath")).toEqual(["temperance"]);
    expect(classifyRisk("Hybris")).toEqual(["magnanimity"]);
    expect(classifyRisk("Political naïveté")).toEqual(["prudence"]);
    expect(classifyRisk("Vanity of magnificence")).toEqual(["magnificence", "magnanimity"]);
  });

  it("maps every figure onto at least two virtues to imitate and one to guard", () => {
    for (const f of corpus.figures) {
      const imitate = SPINE_ORDER.filter((v) => f.spine[v]?.imitate.length);
      const guard = SPINE_ORDER.filter((v) => f.spine[v]?.guard.length);
      expect(imitate.length, `${f.slug} imitate`).toBeGreaterThanOrEqual(2);
      expect(guard.length, `${f.slug} guard`).toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves no curated label unmapped", () => {
    const missing = corpus.figures.map((f) => ({ slug: f.slug, ...unmappedLabels(f) })).filter((u) => u.virtues.length || u.risks.length);
    expect(missing).toEqual([]);
  });

  it("places Alexander where the profile does", () => {
    const a = corpus.figures.find((f) => f.slug === "alexander")!;
    expect(a.spine.fortitude?.imitate).toContain("Courage in the front rank");
    expect(a.spine.temperance?.guard).toEqual(expect.arrayContaining(["Wrath", "Drunkenness"]));
    expect(a.spine.magnanimity?.imitate).toContain("Magnanimity");
    expect(a.spine.magnanimity?.guard).toContain("Hybris");
    expect(virtueSpine(a)).toEqual(a.spine);
  });

  it("indexes every virtue with several figures", () => {
    const idx = spineIndex(corpus.figures);
    for (const v of SPINE_ORDER) expect(idx[v].length, v).toBeGreaterThanOrEqual(4);
    expect(idx.magnificence.map((e) => e.slug)).toEqual(expect.arrayContaining(["lorenzo-de-medici", "charlemagne"]));
  });

  it("filters search by spine and ranks curated placement first", () => {
    const hits = findExempla(corpus, { spine: "fortitude", limit: 30 });
    expect(hits.length).toBeGreaterThanOrEqual(8);
    expect(hits.every((h) => corpus.figures.find((f) => f.slug === h.slug)!.spine.fortitude)).toBe(true);
    expect(hits[0]!.evidence[0]).toMatch(/^fortitude: /);
    const none = findExempla(corpus, { spine: "magnificence", era: "modern", limit: 30 });
    expect(none.every((h) => h.eraGroup === "modern")).toBe(true);
  });

  it("appears in the system prompt and the tools", async () => {
    const digest = spineDigest(corpus);
    for (const v of SPINE_ORDER) expect(digest.toLowerCase()).toContain(v);
    expect(digest).toContain("Alexander the Great");
    const system = buildSystemPrompt(corpus, "dialectical").map((b) => b.text).join("\n");
    expect(system).toContain("# The virtue spine");
    expect(system).toContain("train a new elite in an aristocratic pattern");
    expect(system).toContain("unkind truths kindly");
    const tools = makeTutorTools(corpus);
    const find = tools.find((t) => t.name === "find_exempla")!;
    const out = await find.run(find.parse({ spine: "magnificence", limit: 3 }) as never);
    expect(out).toMatch(/magnificence: imitate/);
    const lookup = tools.find((t) => t.name === "lookup_great_man")!;
    expect(await lookup.run(lookup.parse({ figure: "alexander" }) as never)).toContain("## Virtue spine");
  });
});
