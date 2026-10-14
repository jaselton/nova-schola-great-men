# Changelog

## 0.2.0 — 2026-10-14

The inference layer.

### Added
- **Structured corpus.** `src/corpus/` parses every profile and research essay into `data/great-men.json` (metadata, one-minute story, teaches/warns, formation signature, quick practice, lesson titles and discussion questions, research summary, raw README sections, search keywords). Deterministic output; the test suite fails if the JSON is stale.
- **Trivium tutor on the Claude 5 family.** `src/inference/`: model registry (Opus 5.5 default; Sonnet 5.5, Haiku 5.5, Fable 5.1 tiers), developmental bands with per-band effort, cache-stable system prompt v3 with a library digest, six library tools (Zod-validated), heuristic and Haiku-backed trivium-mode router, and a streaming `Tutor` with serializable session state, adaptive thinking, server-side refusal fallback, and tool-round budgeting.
- **CLI** `nova-tutor`: `models`, `build`, `search`, `show`, `prompt`, `ask`, `chat`, `generate`, `review`.
- **Pipelines.** `generate` drafts a new figure (research essay + six profile files + `meta.json`) in the house style against a cached exemplar; `review` produces a structured factual, age-calibration and template review of any figure.
- **Evals.** Twelve rubric-graded cases and a Haiku-judged runner.
- **Codex backend.** `backend: "codex"` / `--backend codex` runs each turn through the local OpenAI Codex CLI (`codex exec`, ignoring user config, ephemeral, read-only sandbox) with the library served over MCP; transcript replayed per turn so session state stays serializable. Transient Codex transport errors are warnings, not failures.
- **MCP server.** `src/mcp/server.ts` (`great-men-mcp` bin) exposes the six library tools to any MCP client, annotated read-only.
- **Hosting example.** `examples/netlify-tutor.ts`, stateless.
- **Docs.** `framework/TRIVIUM_ARCHITECTURE.md` (the February 2026 design, now in the repo), `framework/TUTOR_SYSTEM_PROMPT.md` v3, README rewrite.

### Changed
- README structure section now matches the repository (the referenced `TEACHING_GUIDE.md` never existed).
- `.gitignore` covers Node artifacts and eval results.

## 0.1.0 — 2026-05-11

Twenty-five profiles complete (Day 1 Leonardo through Day 25 Churchill), each with a README, three student lessons, a parent guide, a one-week lesson plan and a research essay. Framework and profile template.
