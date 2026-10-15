import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/corpus/index.js";
import { BANDS, bandForAge } from "../src/inference/bands.js";
import { estimateCost, MODELS, resolveModel } from "../src/inference/models.js";
import { buildSystemPrompt, corpusDigest, PERSONA_PROMPT, studentContextBlock } from "../src/inference/prompt.js";
import { detectModeHeuristic } from "../src/inference/router.js";
import { makeTutorTools } from "../src/inference/tools.js";

const corpus = loadCorpus();

describe("bands", () => {
  it.each([
    [5, "foundational"],
    [8, "foundational"],
    [9, "formative"],
    [13, "formative"],
    [14, "dialectical"],
    [18, "dialectical"],
    [19, "integrative"],
    [45, "integrative"],
  ])("age %i -> %s", (age, band) => {
    expect(bandForAge(age)).toBe(band);
  });
  it("retrieves the right shipped lesson per band", () => {
    expect(BANDS.foundational.lessonRange).toBe("8-10");
    expect(BANDS.formative.lessonRange).toBe("11-14");
    expect(BANDS.dialectical.lessonRange).toBe("15-18");
  });
});

describe("router heuristics", () => {
  it.each([
    ["Who was Julius Caesar?", "grammar"],
    ["What does hubris mean?", "grammar"],
    ["I got the answer but I'm not sure why it works.", "logic"],
    ["Why did Alexander burn Persepolis?", "logic"],
    ["I wrote about Alexander but it sounds boring.", "rhetoric"],
    ["How do I write a thesis for my essay on Cicero?", "rhetoric"],
    ["Was Napoleon right to crown himself?", "rhetoric"],
  ])("%s -> %s", (text, mode) => {
    expect(detectModeHeuristic(text).mode).toBe(mode);
  });
});

describe("models", () => {
  it("defaults to Opus 5.5 and resolves tiers and ids", () => {
    expect(resolveModel().id).toBe("claude-opus-5-5");
    expect(resolveModel("fast").id).toBe("claude-sonnet-5-5");
    expect(resolveModel("claude-haiku-5-5").tier).toBe("classifier");
    expect(resolveModel("claude-fable-5-1").serverFallback).toBe(true);
    expect(resolveModel("some-custom-id").id).toBe("some-custom-id");
  });
  it("estimates cost with cache discount", () => {
    const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 1 }, MODELS.tutor);
    expect(cost).toBeCloseTo(4);
    const cached = estimateCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, requests: 1 }, MODELS.tutor);
    expect(cached).toBeCloseTo(0.2);
  });
});

describe("system prompt", () => {
  it("is deterministic, cached on the last block only, and carries the whole library", () => {
    const a = buildSystemPrompt(corpus, "formative");
    const b = buildSystemPrompt(corpus, "formative");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.filter((blk) => blk.cache_control).length).toBe(1);
    expect(a[a.length - 1]!.cache_control).toEqual({ type: "ephemeral" });
    const text = a.map((blk) => blk.text).join("\n");
    for (const f of corpus.figures) expect(text).toContain(`[${f.slug}]`);
    expect(text).toContain("FORMATIVE");
    expect(text.length).toBeGreaterThan(12_000);
    expect(text.length).toBeLessThan(60_000);
  });
  it("differs by band and adds the parent addendum only when asked", () => {
    const f = buildSystemPrompt(corpus, "foundational").map((b) => b.text).join();
    const d = buildSystemPrompt(corpus, "dialectical").map((b) => b.text).join();
    expect(f).not.toBe(d);
    expect(f).not.toContain("PARENT or TEACHER");
    expect(buildSystemPrompt(corpus, "foundational", { parentMode: true }).map((b) => b.text).join()).toContain("PARENT or TEACHER");
  });
  it("keeps volatile context out of the system prompt", () => {
    expect(PERSONA_PROMPT).not.toMatch(/\{\{|Date:|today/i);
    const ctx = studentContextBlock({ name: "Ada", age: 12, band: "formative", subject: "History", strengths: ["memory"] });
    expect(ctx).toContain("<student_profile>");
    expect(ctx).toContain("name: Ada");
    expect(ctx).toContain("recent_strengths: memory");
    expect(studentContextBlock({ band: "formative", parentMode: true, age: 9 })).toContain("<parent_or_teacher_profile>");
  });
  it("digest entries use research virtues for quote-led profiles", () => {
    const digest = corpusDigest(corpus);
    expect(digest).toMatch(/Socrates \[socrates\][\s\S]*?Imitate: /);
  });
});

describe("tools", () => {
  const tools = makeTutorTools(corpus, { defaultAgeRange: "11-14" });
  it("are sorted by name with JSON schemas", () => {
    expect(tools.map((t) => t.name)).toEqual([...tools.map((t) => t.name)].sort());
    expect(tools.map((t) => t.name)).toContain("lookup_great_man");
    for (const t of tools) expect(t.input_schema.type).toBe("object");
  });
  it("lookup_great_man returns an overview and handles strangers", async () => {
    const lookup = tools.find((t) => t.name === "lookup_great_man")!;
    const out = await lookup.run(lookup.parse({ figure: "da Vinci" }) as never);
    expect(out).toContain("Leonardo da Vinci");
    expect(out).toContain("Virtues to imitate");
    const miss = await lookup.run(lookup.parse({ figure: "Hannibal" }) as never);
    expect(miss).toMatch(/No profile for "Hannibal"/);
  });
  it("get_student_lesson defaults to the band's range and can filter a section", async () => {
    const lesson = tools.find((t) => t.name === "get_student_lesson")!;
    const full = await lesson.run(lesson.parse({ figure: "alexander" }) as never);
    expect(full).toContain("Ages 11-14");
    const part = await lesson.run(lesson.parse({ figure: "alexander", age_range: "8-10", section: "Story" }) as never);
    expect(part).toMatch(/^## The Story/);
  });
  it("parse rejects malformed input", () => {
    const lookup = tools.find((t) => t.name === "lookup_great_man")!;
    expect(() => lookup.parse({ figure: 42 })).toThrow();
    expect(() => lookup.parse({})).toThrow();
  });
  it("find_exempla returns ranked evidence", async () => {
    const find = tools.find((t) => t.name === "find_exempla")!;
    const out = await find.run(find.parse({ struggle: "quitting when things get hard" }) as never);
    expect(out).toMatch(/\[[a-z-]+\]/);
  });
});
