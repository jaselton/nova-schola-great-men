# Nova Schola AI Tutor — System Prompt v3.0
## Layered Trivium Architecture on the Claude 5 family

*Supersedes System Prompt v2.0 (February 9, 2026).*

---

## Where the prompt lives

The prompt is code, not a document, so that the tutor, the evals and this
note cannot drift apart:

| Piece | File |
|---|---|
| Unified persona, trivium modes, library rules, voice, care clause | `src/inference/prompt.ts` → `PERSONA_PROMPT` |
| Parent/teacher addendum | `src/inference/prompt.ts` → `PARENT_MODE_ADDENDUM` |
| Developmental band calibrations (Layer 2) | `src/inference/bands.ts` → `BANDS` |
| Library digest (one block per figure, sequence order) | `src/inference/prompt.ts` → `corpusDigest()` |
| Per-session student context | `src/inference/prompt.ts` → `studentContextBlock()` |
| Tools the model may call | `src/inference/tools.ts` |
| Mode detection heuristics and classifier | `src/inference/router.ts` |

Print the assembled prompt for any band:

```bash
npx tsx src/cli.ts prompt --band dialectical
npx tsx src/cli.ts prompt --band foundational --parent
```

---

## Layout and caching

```
system[0]  PERSONA_PROMPT                       stable for the deployment
system[1]  "# Developmental calibration" + band  stable per band
system[2]  PARENT_MODE_ADDENDUM                  only in parent mode
system[3]  "# Operator notes"                    optional, stable per deployment
system[4]  library digest                        stable until the corpus changes   ← cache breakpoint
messages[0].content[0]  <student_profile> … </student_profile>   per session
messages[0].content[1]  the student's first message              per turn
```

Render order on the API is tools → system → messages, so the breakpoint on
the last system block caches the tool definitions and the whole system
prompt together, once per (band, parent-mode) pair, and every session in that
band reads it. Nothing in `system` carries a date, a name, or an id. The
student's context sits in the first user turn, after the breakpoint. One
message-level breakpoint is moved to the newest user turn on each request so
the conversation prefix accrues cache hits as it grows.

---

## What changed from v2

| Area | v2 (Feb 2026) | v3 (Oct 2026) |
|---|---|---|
| Model | unspecified Netlify `tutor.js` | Claude Opus 5.5 default; Sonnet 5.5 / Haiku 5.5 / Fable 5.1 tiers (`src/inference/models.ts`) |
| Thinking | none | adaptive thinking; effort set per band (low → high) |
| The library | "Rich with exempla from great lives" (from memory) | A digest of all 25 figures in the prompt plus six tools that return the actual profiles, lessons, guides and essays; rule: retrieve before you rely, never invent quotations |
| Band calibration | inline in the prompt | `BANDS` table; each band also names which shipped student lesson to retrieve |
| Context variables | a JSON blob appended to the system prompt | `<student_profile>` block in the first user turn, so the system prompt stays cacheable |
| Parent use | not addressed | parent mode addendum + `get_parent_guide` / `get_week_plan` tools |
| Response style | "2-5 sentences … end with forward motion" | kept; adds "prose as speech, no markdown unless asked", one question at a time |
| Care | none | no personal data beyond the profile; drop the persona for a student in distress |
| Refusals | none | server-side fallback on Opus/Sonnet/Fable; in-persona redirect if the whole chain declines |
| Mode tracking | "track trivium mode for continuity" (todo) | heuristic router on every turn; optional Haiku 5.5 classifier; recorded in session state |

The v2 production prompt's structure (Grammar / Logic / Rhetoric; developmental calibration; subject routing; voice; what you never do; the mission) is preserved almost verbatim in `PERSONA_PROMPT` and `BANDS`.

---

## Prompting notes for the Claude 5 family

- Opus 5.5 and Fable 5.1 reason well with fewer, clearer rules. The persona states each rule once; it does not shout. If a behaviour slips in evals, add a single sentence rather than a block of capitals.
- Effort is the main quality/cost lever. Foundational runs at `low` (warmth and speed matter more than depth); dialectical and integrative at `high`. Change it per band in `BANDS`, or per session with `--effort`.
- Forced tool choice is not available on these models; the prompt steers retrieval ("retrieve the material first") and the tools' Zod schemas keep the inputs valid.
- Assistant prefill is gone; response shape is controlled by the "Response style" section and, for structured tasks (review, evals), by structured outputs.

---

## Mode detection

The tutor chooses its own mode; the router exists for logging, balance over time, and eval scoring.

| Student signal | Likely mode |
|---|---|
| "What is…?", "Define…", "Tell me about…", "Who was…?" | Grammar |
| "Why…?", "How does…?", "Prove…", "I got the answer but I'm not sure why" | Logic |
| "How do I write…?", "It sounds boring", "What should I do?", "Was he right?" | Rhetoric |

`detectModeHeuristic()` is free; `classifyMode()` asks Claude Haiku 5.5 with structured output (`--classify` on the CLI).

---

## Example interactions

These are the v2 examples; they remain the target behaviour and are mirrored in `evals/cases.json`.

**Grammar (Foundational, age 7, History).** *Student:* Who was Julius Caesar? *Tutor:* Julius Caesar was a Roman general and statesman who lived over two thousand years ago. He conquered Gaul, which is France today, and became so powerful that he made himself ruler of Rome. He was betrayed and killed by men he thought were his friends. What do you think happened to Rome after he died?

**Logic (Dialectical, age 16, Mathematics).** *Student:* I got the answer but I'm not sure why it works. *Tutor:* Then you do not yet have the answer; you have a number. Walk me through your reasoning. At which step did you stop understanding and start calculating?

**Rhetoric (Formative, age 11, Writing).** *Student:* I wrote about Alexander but it sounds boring. *Tutor:* Read me your first sentence. … You began with a fact. Facts are necessary but not sufficient. What did Alexander want? Start there. A story begins with desire, not data.

---

## Other runtimes

The prompt is model-agnostic text. `buildCodexPrompt()` in `src/inference/codex.ts` wraps the same system blocks, student context and transcript into a single task prompt for OpenAI Codex, and `src/mcp/server.ts` serves the same six tools over MCP so a Codex session calls the identical functions the Claude tutor calls directly. Any other MCP-capable runtime can be wired the same way.

## Hosting

`examples/netlify-tutor.ts` replaces the v2 implementation notes for `tutor.js`: the function is stateless, the client carries `TutorState` between turns, and the corpus is bundled with the function via `included_files`.

---

*Document Version: 3.0*  
*Date: October 14, 2026*  
*Status: Implemented in `src/inference/`*
