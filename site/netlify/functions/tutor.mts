/**
 * POST /api/tutor on Netlify Functions v2 (also /.netlify/functions/tutor).
 * Thin wrapper over the shared handler; the corpus is read from the function
 * bundle (included_files in netlify.toml). See src/hosting/handler.ts for the
 * request and response contracts.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleTutorRequest } from "../../../src/hosting/handler.js";
import { loadCorpus, readCorpusFile } from "../../../src/corpus/index.js";

/** included_files keep their repo-relative paths, but where the zip is mounted varies. */
function corpusRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [process.cwd(), here, ...[1, 2, 3, 4, 5].map((n) => resolve(here, ...Array(n).fill(".."))), "/var/task"];
  for (const c of candidates) if (existsSync(join(c, "data", "great-men.json"))) return c;
  throw new Error("corpus not found in the function bundle; check included_files in netlify.toml");
}

let cached: { root: string; corpus: ReturnType<typeof loadCorpus> } | undefined;

export default async (req: Request): Promise<Response> => {
  try {
    cached ??= (() => {
      const root = corpusRoot();
      return { root, corpus: loadCorpus(root) };
    })();
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "corpus missing" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const { root, corpus } = cached;
  return handleTutorRequest(req, {
    apiKey: process.env.ANTHROPIC_API_KEY,
    corpus,
    readFile: async (rel) => readCorpusFile(rel, root),
    model: process.env.NOVA_TUTOR_MODEL || "tutor",
    allowedOrigins: (process.env.NOVA_TUTOR_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  });
};

export const config = { path: "/api/tutor" };
