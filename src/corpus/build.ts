/**
 * Build `data/great-men.json` from the markdown sources.
 *
 *   npm run build:data
 *
 * The output is deterministic (no timestamps) so it diffs cleanly in git.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCorpus } from "./parse.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

export function buildCorpusJson(root = REPO_ROOT, outFile = join(root, "data", "great-men.json")): string {
  const corpus = parseCorpus(root);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(corpus, null, 2) + "\n");
  return outFile;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const out = buildCorpusJson();
  console.log(`wrote ${out}`);
}
