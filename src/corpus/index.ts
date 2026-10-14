import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCorpus } from "./parse.js";
import type { Corpus } from "./types.js";

export * from "./types.js";
export * from "./catalog.js";
export * from "./search.js";
export * from "./spine.js";
export { listFigureSlugs, parseCorpus, parseProfile, splitSections, stripMarkdown, tokenize } from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root whether running from `src/` (tsx) or `dist/` (compiled). */
export const REPO_ROOT = resolve(here, "..", "..");

/**
 * Load the corpus. Prefers the committed `data/great-men.json` (fast, no
 * markdown parsing at runtime); falls back to parsing the markdown when the
 * JSON is absent, e.g. during development after editing a profile.
 */
export function loadCorpus(root = REPO_ROOT): Corpus {
  const jsonPath = join(root, "data", "great-men.json");
  if (existsSync(jsonPath)) {
    const corpus = JSON.parse(readFileSync(jsonPath, "utf8")) as Corpus;
    if (corpus.schemaVersion === 1) return corpus;
  }
  return parseCorpus(root);
}

/** Read a repo-relative markdown file (profile lesson, parent guide, research essay). */
export function readCorpusFile(relPath: string, root = REPO_ROOT): string {
  const safe = relPath.replace(/\\/g, "/");
  if (safe.includes("..") || !/^(profiles|research|framework)\//.test(safe)) {
    throw new Error(`Refusing to read outside the corpus: ${relPath}`);
  }
  return readFileSync(join(root, safe), "utf8");
}
