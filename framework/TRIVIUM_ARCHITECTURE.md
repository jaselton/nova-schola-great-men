# Nova Schola Trivium Architecture
## Layered AI Tutor System Design

*Captured: February 9, 2026*

---

## Core Principle

**The student experiences ONE tutor. The system underneath is MANY tutors.**

Single interlocutor, multiple internal specialists.

---

## Layer 1 — Trivium Engines (Non-Negotiable)

Three primary cognitive engines, one per realm of the trivium. These are *not* age-bound.

### 1. Grammar Tutor — *The Librarian*

**Function:** Knowledge acquisition, memory, vocabulary, facts  
**Mode:** Declarative, precise, concrete

- Facts, definitions, timelines
- Vocabulary scaffolding
- Memorization loops (spaced repetition)
- Pattern recognition
- Canon exposure (stories, scripture, history, science basics)

> This tutor answers: *"What is?"*

---

### 2. Logic Tutor — *The Examiner*

**Function:** Reasoning, coherence, cause & effect  
**Mode:** Socratic, interrogative

- "Why do you think that?"
- Logical fallacies
- Syllogisms
- Argument construction
- Math reasoning
- Scientific method

> This tutor answers: *"Is it true?"*

---

### 3. Rhetoric Tutor — *The Orator*

**Function:** Expression, synthesis, persuasion  
**Mode:** Narrative, stylistic, performative

- Writing coaching
- Oral argument
- Debate
- Storytelling
- Presentation
- Moral reasoning & judgment

> This tutor answers: *"How should it be said—and to whom?"*

🟢 **These three never go away.** A 6-year-old and a 26-year-old both use them—just at different depths.

---

## Layer 2 — Developmental Modulators (Not Separate Tutors)

**Do NOT create separate tutors per age bracket.** That fractures identity and pedagogy.

Instead, create **developmental filters** that modulate tone, pacing, abstraction, and authority.

### Suggested Bands (Internal Only)

| Band | Age Range | Characteristics |
|------|-----------|-----------------|
| **Foundational** | ≈5–8 | High warmth, concrete examples, short loops, strong narrative |
| **Formative** | ≈9–13 | Guided questioning, pattern discovery, moral clarity, early argumentation |
| **Dialectical** | ≈14–18 | Adversarial logic, competing frameworks, primary sources, writing rigor |
| **Integrative** | 18+ | Cross-domain synthesis, philosophical depth, original production, real-world application |

⚠️ These are **parameters**, not personas.

---

## Layer 3 — The Unified Tutor Persona (What the Student Sees)

This is crucial for trust. **The student interacts with one persistent tutor identity**:

> "A learned guide who speaks plainly, challenges carefully, and expects excellence."

Behind the scenes:
- Grammar engine activates for recall
- Logic engine interrupts sloppy thinking
- Rhetoric engine activates during output

But the *voice remains coherent*.

This mirrors:
- A medieval tutor
- A naval academy instructor
- A classical private master

---

## Layer 4 — Subject-Specific Subagents (Invisible)

Subjects are **domains**, not tutors.

Example:
- **Mathematics** → Grammar (definitions), Logic (proof), Rhetoric (explanation)
- **History** → Grammar (timeline), Logic (causality), Rhetoric (interpretation)
- **Theology** → Grammar (text), Logic (doctrine), Rhetoric (application)

So you don't build:
> "Math Tutor"

You build:
> **Math through the Trivium**

---

## Why This Beats the Alternatives

### ❌ Pure Age-Based Tutors
- Infantilizes advanced students
- Hard walls instead of growth
- Feels like school, not mastery

### ❌ One Universal Flat Tutor
- Too generic
- No pedagogy
- No formation

### ❌ Three Separate Visible Tutors
- Cognitive fragmentation
- Breaks relationship continuity
- Confusing for younger students

### ✅ Layered Trivium System
- Classical legitimacy
- Modern scalability
- Personal without being sentimental
- Rigorous without being sterile

---

## Nova Schola's Advantage (Strategic Insight)

This architecture lets you say—truthfully:

> "We do not teach content.  
> We form minds."

---

## Implementation Notes

### System Prompt Architecture

The unified persona (Aristotle or equivalent) incorporates:
1. **Engine selector** — Routes to Grammar/Logic/Rhetoric based on context
2. **Developmental band** — Adjusts tone, complexity, pacing based on student profile
3. **Subject context** — Applies trivium engines to domain-specific content

### Technical Approach

```
Student Input
     ↓
[Unified Persona Layer]
     ↓
[Developmental Modulator] → adjusts parameters
     ↓
[Engine Router] → Grammar | Logic | Rhetoric
     ↓
[Subject Context] → domain-specific content
     ↓
[Response Generator] → maintains persona coherence
     ↓
Student Output
```

---

*Document Version: 1.0*  
*Status: Architecture Approved*
