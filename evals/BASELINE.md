# Eval baseline

First full run of `evals/cases.json`, 14 October 2026, before any prompt tuning.

| Setting | Value |
|---|---|
| Tutor | OpenAI Codex CLI 0.162, model `gpt-6-astra`, `--backend codex`, effort by band |
| Judge | same model, effort low, `--output-schema` with schema-in-prompt fallback |
| Cases | 12 of 12 completed, 0 errors; 3 judge calls stalled and recovered via fallback |
| Rubric | 33 / 48 criteria (69%) |
| Mean judge score | 3.83 / 5 |
| Trivium mode agreement | 11 / 12 |
| Library tool calls | 23 of 23 succeeded |
| Flattery / tool leaks / missing forward motion | 0 / 0 / 0 |
| Mean tutor turn | 22 s (10–42 s) |
| Tutor tokens | 206K uncached + 579K cached input, 4K output across 12 turns |

| Case | Rubric | Score | Mode | Tools | Note |
|---|---|---|---|---|---|
| found-grammar-caesar | 3/4 | 4 | grammar | 0 | "general" left undefined for a seven-year-old |
| found-story-bucephalus | 3/4 | 3 | grammar | 3 | closing question stayed on Alexander, not the child |
| form-logic-formation | 1/4 | 4 | logic | 3 | explained before asking; skipped Mieza, cohort, Stagira |
| form-rhetoric-boring | 1/4 | 4 | rhetoric | 0 | no retrieval, so no Marcus detail; asked for a topic, not a new sentence |
| form-exemplum-quitting | 3/4 | 3 | logic (exp. rhetoric) | 3 | no concrete challenge for the week |
| dial-logic-persepolis | 2/4 | 4 | logic | 2 | presented the competing reading but did not demand textual evidence |
| dial-rhetoric-thesis | 2/4 | 3 | rhetoric | 2 | offered a thesis "to test" instead of extracting the student's |
| dial-grammar-stoic-terms | 3/4 | 4 | grammar | 2 | hypothetical example instead of one from the Meditations |
| integ-synthesis-institutions | 4/4 | 5 | rhetoric | 4 | |
| parent-leonardo-six | 4/4 | 4 | rhetoric | 4 | used a Markdown list (parent mode allows it when asked) |
| form-off-library | 3/4 | 3 | grammar | 0 | no bridge to a library figure (Napoleon crossing the Alps) |
| form-lazy-answer | 4/4 | 5 | logic | 0 | |

## Systematic misses to tune next

1. **Formative band explains before it asks.** Two of the three lowest cases are the tutor delivering the interpretation and only then posing a question. The persona says "question before telling"; on this model it needs a stronger, band-specific rule.
2. **Retrieval is skipped when the figure is already named.** `form-rhetoric-boring` made no tool call although Marcus Aurelius was the topic, and the reply had no profile detail. A rule such as "when the student names a library figure, retrieve before replying" should fix this cheaply.
3. **Forward motion is generic.** Rubric items asking for a *concrete* next step (try a new first sentence, one challenge this week, state your position in one sentence) fail while the generic "ends with a question" check passes every time.
4. **Foundational vocabulary.** Define every hard word and turn the closing question toward the child's own life; both are already in the band text and still slip.

The Claude Opus 5.5 path has not been run (no Anthropic key on the build machine); the first Anthropic run should use the same cases so the two backends can be compared.
