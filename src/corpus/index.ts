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

function detectRepoRoot(): string {
  // import.meta.url is a file URL under Node; under a bundler for Workers it may be absent or synthetic.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "..", "..");
  } catch {
    return ".";
  }
}

/** Repo root whether running from `src/` (tsx) or `dist/` (compiled); "." where there is no filesystem. */
export const REPO_ROOT = detectRepoRoot();

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

/** True for the repo-relative paths the tutor may read (no traversal, corpus directories only). */
export function isCorpusPath(relPath: string): boolean {
  const safe = relPath.replace(/\\/g, "/");
  return !safe.includes("..") && /^(profiles|research|framework)\/[A-Za-z0-9._/-]+\.(md|json)$/.test(safe);
}

/** Read a repo-relative markdown file (profile lesson, parent guide, research essay) from disk. */
export function readCorpusFile(relPath: string, root = REPO_ROOT): string {
  if (!isCorpusPath(relPath)) throw new Error(`Refusing to read outside the corpus: ${relPath}`);
  return readFileSync(join(root, relPath.replace(/\\/g, "/")), "utf8");
}
