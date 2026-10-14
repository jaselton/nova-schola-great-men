#!/usr/bin/env node
/**
 * nova-tutor: command-line entry to the Great Men corpus and the Trivium tutor.
 *
 *   nova-tutor models                      list the model tiers
 *   nova-tutor build                       rebuild data/great-men.json from markdown
 *   nova-tutor search "fear of failure"    offline exemplum search
 *   nova-tutor show alexander [section]    offline profile lookup
 *   nova-tutor prompt --band formative     print the assembled system prompt
 *   nova-tutor ask "Who was Alexander?" --age 12
 *   nova-tutor chat --age 15 --name Ada --subject History
 *   nova-tutor generate <slug> --name "..." --era-group modern --day 26
 *   nova-tutor review alexander
 *
 * Live commands need ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { buildCorpusJson } from "./corpus/build.js";
import { loadCorpus } from "./corpus/index.js";
import { findExempla, findProfile } from "./corpus/search.js";
import type { EraGroup } from "./corpus/types.js";
import { BANDS, isBand, type Band } from "./inference/bands.js";
import { estimateCost, MODELS, resolveModel, type Effort } from "./inference/models.js";
import { buildSystemPrompt } from "./inference/prompt.js";
import { profileOverview } from "./inference/tools.js";
import { Tutor, type StudentProfile, type TutorOptions } from "./inference/tutor.js";
import { generateProfile } from "./pipeline/generate-profile.js";
import { reviewProfile } from "./pipeline/review-profile.js";

const USAGE = `nova-tutor <command> [options]

Offline
  models                         list model tiers and prices
  build                          rebuild data/great-men.json from the markdown
  search <text> [--virtue --struggle --era --domain --limit]
  show <figure> [section]        section: overview|story|why|signature|research
  prompt [--band B] [--parent]   print the assembled system prompt

Live (needs ANTHROPIC_API_KEY)
  ask <question>                 one tutor turn
  chat                           interactive session (/state, /quit)
  generate <slug> --name N --era-group E --day D [--era --domain --notes --model --web --dry-run]
  review <figure> [--model M]    structured review of an existing profile

Student options (ask/chat)
  --age N  --band B  --name N  --subject S  --topic T  --parent
  --strengths "a;b"  --challenges "a;b"  --summary "previous sessions"
Model options
  --model tutor|fast|frontier|<id>  --effort low|medium|high|xhigh|max
  --no-tools  --no-fallbacks  --thinking  --classify  --json  --verbose
`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    age: { type: "string" },
    band: { type: "string" },
    name: { type: "string" },
    subject: { type: "string" },
    topic: { type: "string" },
    parent: { type: "boolean", default: false },
    strengths: { type: "string" },
    challenges: { type: "string" },
    summary: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    "no-tools": { type: "boolean", default: false },
    "no-fallbacks": { type: "boolean", default: false },
    thinking: { type: "boolean", default: false },
    classify: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    virtue: { type: "string" },
    struggle: { type: "string" },
    era: { type: "string" },
    domain: { type: "string" },
    limit: { type: "string" },
    "era-group": { type: "string" },
    day: { type: "string" },
    notes: { type: "string" },
    web: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    save: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, ...rest] = positionals;

function studentFromFlags(): StudentProfile {
  const band = v.band ? (isBand(v.band) ? (v.band as Band) : fail(`Unknown band ${v.band}`)) : undefined;
  const list = (s?: string) => (s ? s.split(";").map((x) => x.trim()).filter(Boolean) : undefined);
  return {
    name: v.name,
    age: v.age ? Number(v.age) : undefined,
    band,
    subject: v.subject,
    topic: v.topic,
    strengths: list(v.strengths),
    challenges: list(v.challenges),
    sessionSummary: v.summary,
    parentMode: v.parent,
  };
}

function tutorOptions(): TutorOptions {
  return {
    model: v.model,
    effort: v.effort as Effort | undefined,
    tools: !v["no-tools"],
    fallbacks: !v["no-fallbacks"],
    thinkingDisplay: v.thinking ? "summarized" : "omitted",
    classifyModes: v.classify,
  };
}

function printTurnMeta(tutor: Tutor, reply: Awaited<ReturnType<Tutor["reply"]>>): void {
  const cost = estimateCost(reply.usage, tutor.model);
  const tools = reply.toolCalls.map((c) => `${c.name}${c.ok ? "" : "!"}`).join(", ") || "none";
  console.error(
    `\n[mode ${reply.mode.mode} (${reply.mode.confidence.toFixed(2)}) | tools ${tools} | ${reply.servedBy} | ` +
      `in ${reply.usage.inputTokens} cached ${reply.usage.cacheReadTokens} out ${reply.usage.outputTokens} | ~$${cost.toFixed(4)}]`,
  );
}

async function main(): Promise<void> {
  if (!command || v.help) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "models": {
      for (const m of Object.values(MODELS)) {
        console.log(`${m.tier.padEnd(11)} ${m.id.padEnd(20)} $${m.inputPerMTok}/$${m.outputPerMTok} per MTok in/out, cache read $${m.cacheReadPerMTok}`);
        console.log(`${"".padEnd(11)} ${m.role}`);
      }
      return;
    }
    case "build": {
      const out = buildCorpusJson();
      console.log(`wrote ${out}`);
      return;
    }
    case "search": {
      const corpus = loadCorpus();
      const hits = findExempla(corpus, {
        query: rest.join(" ") || undefined,
        virtue: v.virtue,
        struggle: v.struggle,
        era: v.era as EraGroup | undefined,
        domain: v.domain,
        limit: v.limit ? Number(v.limit) : 5,
      });
      if (v.json) return console.log(JSON.stringify(hits, null, 2));
      if (!hits.length) return console.log("No matches.");
      for (const h of hits) {
        console.log(`${h.name} [${h.slug}] score ${h.score} — ${h.subtitle}`);
        for (const e of h.evidence) console.log(`   • ${e}`);
      }
      return;
    }
    case "show": {
      const corpus = loadCorpus();
      const [ref, section] = rest;
      if (!ref) fail("show <figure> [section]");
      const p = findProfile(corpus, ref);
      if (!p) fail(`No profile for "${ref}". Try one of: ${corpus.figures.map((f) => f.slug).join(", ")}`);
      if (v.json) return console.log(JSON.stringify(p, null, 2));
      switch (section) {
        case "story":
          return console.log(p.oneMinuteStory);
        case "why":
          return console.log(p.sections["Why He Matters for Your Child"] ?? "");
        case "signature":
          return console.log(p.sections["Formation Signature"] ?? "");
        case "research":
          return console.log(JSON.stringify(p.research, null, 2));
        default:
          return console.log(profileOverview(p));
      }
    }
    case "prompt": {
      const corpus = loadCorpus();
      const band = v.band && isBand(v.band) ? (v.band as Band) : "formative";
      const blocks = buildSystemPrompt(corpus, band, { parentMode: v.parent });
      const text = blocks.map((b) => b.text).join("\n\n---\n\n");
      if (v.json) return console.log(JSON.stringify(blocks, null, 2));
      console.log(text);
      console.error(`\n[${blocks.length} blocks, ${text.length} chars, ~${Math.round(text.length / 4)} tokens (rough); band ${band}]`);
      return;
    }
    case "ask": {
      const question = rest.join(" ");
      if (!question) fail("ask <question>");
      const tutor = new Tutor(studentFromFlags(), tutorOptions());
      const reply = await tutor.reply(question, {
        onText: v.json ? undefined : (d) => stdout.write(d),
        onThinking: v.thinking && !v.json ? (d) => process.stderr.write(d) : undefined,
      });
      if (v.json) console.log(JSON.stringify({ reply, state: tutor.toState() }, null, 2));
      else {
        stdout.write("\n");
        if (v.verbose) printTurnMeta(tutor, reply);
      }
      return;
    }
    case "chat": {
      const student = studentFromFlags();
      const tutor = new Tutor(student, tutorOptions());
      console.error(`Nova Schola tutor — ${tutor.model.label}, band ${BANDS[tutor.band].label}${student.parentMode ? ", parent mode" : ""}. /state to dump, /quit to leave.`);
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        for (;;) {
          const line = (await rl.question("\n> ")).trim();
          if (!line) continue;
          if (line === "/quit" || line === "/exit") break;
          if (line === "/state") {
            console.log(JSON.stringify(tutor.toState(), null, 2));
            continue;
          }
          stdout.write("\n");
          const reply = await tutor.reply(line, { onText: (d) => stdout.write(d) });
          stdout.write("\n");
          if (v.verbose) printTurnMeta(tutor, reply);
          if (v.save) writeFileSync(v.save, JSON.stringify(tutor.toState(), null, 2));
        }
      } finally {
        rl.close();
        const cost = estimateCost(tutor.usage, tutor.model);
        console.error(`\n[session: ${tutor.turns.length} turns, ${tutor.usage.requests} requests, ~$${cost.toFixed(4)}]`);
      }
      return;
    }
    case "generate": {
      const [slug] = rest;
      if (!slug || !v.name || !v["era-group"] || !v.day) fail("generate <slug> --name N --era-group ancient|medieval|renaissance|modern --day D");
      const result = await generateProfile({
        slug,
        name: v.name,
        eraGroup: v["era-group"] as EraGroup,
        day: Number(v.day),
        era: v.era,
        domain: v.domain,
        notes: v.notes,
        model: v.model,
        web: v.web,
        dryRun: v["dry-run"],
        onText: v.verbose ? (d) => process.stderr.write(d) : undefined,
        onStage: (s) => console.error(`\n== ${s}`),
      });
      console.log(JSON.stringify({ files: result.files, usage: result.usage, estimatedCostUsd: result.estimatedCostUsd }, null, 2));
      return;
    }
    case "review": {
      const [ref] = rest;
      if (!ref) fail("review <figure>");
      const result = await reviewProfile({ figure: ref, model: v.model, onStage: (s) => console.error(`== ${s}`) });
      console.log(result.markdown);
      console.error(`\n[written ${result.files.join(", ")} | ~$${result.estimatedCostUsd.toFixed(3)} on ${resolveModel(v.model).label}]`);
      return;
    }
    default:
      fail(`Unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
