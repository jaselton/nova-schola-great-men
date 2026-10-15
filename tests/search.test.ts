import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus/index.js";
import { ageRangeFor, expandTerms, findExempla, findProfile } from "../src/corpus/search.js";

const corpus = loadCorpus();

describe("findProfile", () => {
  it.each([
    ["alexander", "alexander"],
    ["Alexander the Great", "alexander"],
    ["da Vinci", "leonardo"],
    ["Leonardo da Vinci", "leonardo"],
    ["Marcus", "marcus-aurelius"],
    ["marcus aurelius", "marcus-aurelius"],
    ["Newton", "isaac-newton"],
    ["Aquinas", "thomas-aquinas"],
    ["Churchill", "winston-churchill"],
    ["George Washington", "george-washington"],
    ["Medici", "lorenzo-de-medici"],
    ["René Descartes", "rene-descartes"],
  ])("resolves %s", (ref, slug) => {
    expect(findProfile(corpus, ref)?.slug).toBe(slug);
  });
  it("returns undefined for strangers", () => {
    expect(findProfile(corpus, "Genghis Khan")).toBeUndefined();
    expect(findProfile(corpus, "")).toBeUndefined();
  });
});

describe("findExempla", () => {
  it("finds the figures whose signature virtue is courage", () => {
    const hits = findExempla(corpus, { virtue: "courage", limit: 8 });
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.map((h) => h.slug)).toContain("alexander");
    expect(hits.map((h) => h.slug)).toContain("winston-churchill");
    for (const h of hits.slice(0, 3)) expect(h.evidence.join(" ")).toMatch(/courage/i);
  });
  it("maps student language onto the curated vocabulary", () => {
    const quitting = findExempla(corpus, { struggle: "I keep quitting when things get hard" });
    expect(quitting.slice(0, 4).map((h) => h.slug)).toContain("leonardo");
    const afraid = findExempla(corpus, { struggle: "afraid of being wrong" });
    expect(afraid[0]!.evidence.join(" ")).toMatch(/courage|honest|wrong/i);
    expect([...expandTerms("quitting")]).toContain("persistence");
  });
  it("finds pride as a risk", () => {
    const hits = findExempla(corpus, { struggle: "pride" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.score > 0)).toBe(true);
  });
  it("respects era and limit filters", () => {
    const hits = findExempla(corpus, { query: "patience observation", era: "renaissance", limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.every((h) => h.eraGroup === "renaissance")).toBe(true);
  });
  it("returns everyone for a filter-only query", () => {
    expect(findExempla(corpus, { era: "medieval", limit: 10 }).length).toBe(5);
  });
});

describe("ageRangeFor", () => {
  it("maps ages to the shipped lesson ranges", () => {
    expect(ageRangeFor(7)).toBe("8-10");
    expect(ageRangeFor(10)).toBe("8-10");
    expect(ageRangeFor(11)).toBe("11-14");
    expect(ageRangeFor(14)).toBe("11-14");
    expect(ageRangeFor(15)).toBe("15-18");
    expect(ageRangeFor(40)).toBe("15-18");
  });
});
