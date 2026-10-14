# Great Men: Educational Profiles

A structured collection of biographical educational profiles designed to teach virtue, agency, and excellence through the study of history's most consequential figures — and the inference layer that lets an AI tutor teach from them.

## Purpose

This repository implements the **Great Man Framework** — a classical educational approach that uses biography as moral and intellectual instruction. Each profile examines:

- **Early formation** — family, mentors, education
- **Defining moments** — crucible experiences that forged character
- **Peak achievements** — what they built and why it mattered
- **Failure and recovery** — how they handled adversity
- **Legacy and lessons** — what students should take forward

These profiles are designed for:
- **Parents** building classical curriculum at home
- **Educators** teaching history, ethics, and leadership
- **Students** seeking models of virtuous action
- **AI tutors** (including the Nova Schola platform) delivering adaptive education

Since v0.2 the repository also ships the tutor itself: a TypeScript package that parses the profiles into structured data and runs Nova Schola's layered **Trivium tutor** on the Claude 5 model family, with the profiles available to the model as tools.

## What is here

```
profiles/<slug>/            25 figures × 6 files (README, three student lessons, parent guide, week plan)
research/<slug>-full.md     25 research essays following framework/PROFILE_TEMPLATE.md
framework/                  GREAT_MAN_FRAMEWORK.md, PROFILE_TEMPLATE.md,
                            TRIVIUM_ARCHITECTURE.md, TUTOR_SYSTEM_PROMPT.md
data/great-men.json         the corpus as structured data (generated; committed)
src/corpus/                 markdown parser, search, JSON builder
src/inference/              models, developmental bands, system prompt, tools, router, Tutor, Codex backend
src/mcp/server.ts           the library tools as an MCP server (stdio) for Codex or any MCP client
src/pipeline/               generate a new figure; review an existing one
src/cli.ts                  nova-tutor command line
evals/                      rubric-graded eval cases and runner
site/                       deployable tutor demo for novaschola.io (page + Netlify function)
examples/netlify-tutor.ts   minimal stateless hosting example
tests/                      vitest suite (offline; no API key needed)
```

## Quickstart

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...        # or: ant auth login
npx tsx src/cli.ts chat --age 12 --name Ada --subject History
```

Offline, no key required:

```bash
npx tsx src/cli.ts show alexander             # structured overview of a figure
npx tsx src/cli.ts search "fear of being wrong" --limit 3
npx tsx src/cli.ts prompt --band formative    # the assembled system prompt
npx tsx src/cli.ts models                     # tiers and prices
npm test                                      # parser, search, prompt and tutor-loop tests
```

One-shot turns and parent mode:

```bash
npx tsx src/cli.ts ask "Why did Philip hire Aristotle?" --age 12 --verbose
npx tsx src/cli.ts ask "Is Leonardo a good first figure for a six-year-old?" --age 6 --parent
```

## The inference layer

The design follows `framework/TRIVIUM_ARCHITECTURE.md`: the student experiences **one tutor**; underneath are three engines (Grammar, Logic, Rhetoric), a developmental modulator, and the library.

```
student turn
   │
   ▼
Tutor (one persistent voice)
   system prompt = persona + trivium + band calibration + library digest   ← cached per band
   first user turn = <student_profile> context + message                   ← after the breakpoint
   │
   ▼
Claude Opus 5.5  (adaptive thinking; effort set by band; server-side refusal fallback on)
   │  tool calls, validated with Zod, run locally
   ▼
library tools ──► profiles/ research/ data/great-men.json
   lookup_great_man · find_exempla · get_student_lesson
   get_discussion_questions · get_parent_guide · get_week_plan
   │
   ▼
reply + trivium mode + tool log + token usage (+ serializable session state)
```

### Developmental bands

| Band | Ages | Lesson retrieved | Effort | Stance |
|---|---|---|---|---|
| Foundational | ≈5–8 | ages 8-10 | low | warmth, concrete stories, one idea per turn |
| Formative | ≈9–13 | ages 11-14 | medium | guided questioning, pattern discovery, early argument |
| Dialectical | ≈14–18 | ages 15-18 | high | adversarial logic, primary sources, writing rigor |
| Integrative | 18+ | ages 15-18 + research essays | high | cross-domain synthesis, peer in training |

The band is derived from `age` unless set explicitly. Bands are parameters, not personas.

### Models

| Tier | Model | Role |
|---|---|---|
| `tutor` (default) | `claude-opus-5-5` | The tutor. $4 / $20 per MTok, cache reads $0.20. |
| `fast` | `claude-sonnet-5-5` | Lower-latency tutor tier for high-volume chat once the prompt is evaluated. |
| `classifier` | `claude-haiku-5-5` | Trivium-mode classification and eval judging. |
| `frontier` | `claude-fable-5-1` | Opt-in for drafting new research essays where depth matters more than cost. |
| `codex` | `gpt-6-astra` via the Codex CLI | The same tutor run through OpenAI Codex with its own login; the library is served over MCP. |

Pick a tier or any model id with `--model` on the CLI or `model` in `TutorOptions`.

### Running on OpenAI Codex

If the machine has the Codex CLI signed in (`codex login`) but no Anthropic key, run the same tutor through Codex:

```bash
npx tsx src/cli.ts chat --age 12 --backend codex                    # default model gpt-6-astra
npx tsx src/cli.ts ask "Who was Alexander?" --age 8 --backend codex --verbose
npm run eval -- --backend codex --limit 3                           # tutor and judge both through Codex
```

Each turn is one non-interactive `codex exec`: `--ignore-user-config` (no plugins, personality or personal MCP servers), an ephemeral session, a read-only sandbox and an empty working directory. The tutor instructions, student context and transcript go in as the prompt; the six library tools are served to Codex over MCP by `src/mcp/server.ts`, annotated read-only so Codex runs them without approval prompts; the final agent message is the reply. Codex does not stream tokens, so a reply lands whole after roughly 20–60 seconds, and usage is billed to the ChatGPT plan rather than per token. This backend is for local and development use; serverless hosting needs the Claude API path.

The MCP server stands on its own for any MCP client:

```bash
node dist/mcp/server.js        # env: GREAT_MEN_ROOT, GREAT_MEN_AGE_RANGE (8-10 | 11-14 | 15-18)
```

### What the tutor does and will not do

It questions before telling, references specific lives and moments, demands the student's best, ends every turn with forward motion, and writes in prose. It does not flatter, lower standards, hand over answers without thought, mention its tools, or fragment into several voices. Students may be children: it asks for no personal information and drops the persona to point a student in distress to a trusted adult.

### Caching and cost

Tools and the system prompt (persona, band text, ~4K-token library digest) are stable per band and cached across every session in that band. Per-student context lives in the first user turn, after the breakpoint, and one message-level breakpoint moves forward each turn. A typical Opus 5.5 turn with one tool call reads 10–20K cached tokens and writes a few hundred; expect roughly $0.02–0.06 per student turn, less on the `fast` tier. `--verbose` prints per-turn usage and an estimate.

### Safety

Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 run safety classifiers that can decline a request. The tutor enables the API's server-side fallback (`fallbacks: "default"`) so a decline is retried on a fallback model within the same call, and if the whole chain declines it answers with a short in-persona redirect and sets `refused: true`. Disable with `--no-fallbacks` or `fallbacks: false`.

## Programmatic use

```ts
import { Tutor } from "@nova-schola/great-men";

const tutor = new Tutor({ name: "Ada", age: 12, subject: "History" });
const reply = await tutor.reply("Who was Alexander?", { onText: (d) => process.stdout.write(d) });
console.log(reply.mode.mode, reply.toolCalls, reply.usage);

const state = tutor.toState();           // JSON-serializable; send to the client
const later = Tutor.fromState(state);    // resume on any host
```

Pass `backend: "codex"` to run the same session through the Codex CLI. Lower-level pieces are exported too: `loadCorpus`, `findProfile`, `findExempla`, `buildSystemPrompt`, `makeTutorTools`, `detectModeHeuristic`, `classifyMode`, `bandForAge`, `MODELS`, `runCodexTurn`.

## Hosting

`site/` is the deployable tutor demo for novaschola.io: a static page (`site/public/index.html`, styled like the main site, with student age, name and parent-mode controls) and one Netlify Function (`site/netlify/functions/tutor.mts`, served at `/api/tutor`). The function is stateless: the page posts `{ message, student }` on the first turn and `{ message, state }` afterwards, and it also accepts the original demo page's `{ messages }` contract and returns `message` for it. The corpus is bundled with the function through `included_files` in the root `netlify.toml`.

```bash
netlify deploy --site novaschola-tutor --dir site/public --functions site/netlify/functions --no-build          # draft URL
netlify deploy --site novaschola-tutor --dir site/public --functions site/netlify/functions --no-build --prod   # production
```

The site needs `ANTHROPIC_API_KEY` (scope: functions). Optional: `NOVA_TUTOR_MODEL` (tier or model id, default `tutor`), `NOVA_TUTOR_ORIGINS` (comma-separated allowed origins for CORS; default any). `examples/netlify-tutor.ts` is the minimal version of the same handler for other projects.

## Extending the corpus

New figures (Day 26 onward) are drafted in the house style from the framework, the template, and the complete Alexander set as exemplar:

```bash
npx tsx src/cli.ts generate florence-nightingale --name "Florence Nightingale" \
  --era-group modern --day 26 --domain "Nursing, Statistics, Reform" --model tutor --web
npx tsx src/cli.ts review florence-nightingale     # structured factual + age-calibration review → reviews/
npm run build:data                                  # refresh data/great-men.json
npm test                                            # the suite fails if the JSON is stale
```

A generated figure carries `profiles/<slug>/meta.json` so the parser picks it up without a code change. Drafts are marked as such; read the review and the sources before a child does.

`review` works on the existing 25 as well and is the fastest way to find dated claims or an 8-10 lesson that leaks material the parent guide says to leave for later.

## Evals

`evals/cases.json` holds twelve rubric-graded cases across the four bands and three modes, including parent mode, an off-library figure, and a lazy-answer probe. `npm run eval` plays each through the tutor and grades it with Claude Haiku 5.5 as judge (or the Codex model with `--backend codex`), reporting rubric hits, trivium-mode agreement, whether the expected figure was consulted, and leaks (flattery, markdown, tool mentions, missing forward motion). Results land in `evals/results/`. Each run costs money; use `--only` and `--limit` while iterating.

## The 25 Figures

### Ancient (8)
- Alexander the Great
- Plato
- Aristotle
- Marcus Aurelius
- Socrates
- Isocrates
- Cicero
- Quintilian

### Medieval (5)
- Augustine
- Boethius
- Charlemagne
- Alcuin
- Anselm

### Renaissance & Early Modern (7)
- Thomas Aquinas
- Lorenzo de' Medici
- Leonardo da Vinci
- Erasmus
- Galileo Galilei
- René Descartes
- Isaac Newton

### Modern (5)
- Frederick the Great
- George Washington
- Thomas Jefferson
- Napoleon Bonaparte
- Winston Churchill

Each profile directory holds a README (one-minute story, why he matters, formation signature, quick practice), student lessons for ages 8-10, 11-14 and 15-18, a parent guide, and a one-week lesson plan; the matching research essay follows the template in `framework/`.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest, offline
npm run build:data    # regenerate data/great-men.json after editing any profile
npm run build         # compile to dist/ (exposes the nova-tutor bin)
```

## License

MIT License — free to use, adapt, and build upon.

## Contributing

This is a living curriculum. Contributions welcome:
- Corrections and improvements to existing profiles
- Additional primary source excerpts
- Teaching notes from practical use
- Translations
- Eval cases that catch the tutor doing the wrong thing

Open an issue or PR.

## Author

**John Aselton**  
Founder, Nova Schola  
[john@novaschola.io](mailto:john@novaschola.io)

## Acknowledgments

Built on the shoulders of giants — the classical tradition from Plutarch's *Lives* to Allan Bloom's *The Closing of the American Mind*.
