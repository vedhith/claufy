---
slug: market-research
phase: ideation
execution: CONDITIONAL
condition: Execute for MVP and whenever an initiative needs market positioning or build-vs-buy research. Reuse verified current evidence for unchanged scope; do not skip MVP research merely because the product is internal.
lead_agent: aidlc-product-agent
support_agents: []
mode: inline
summary_confirmation: required
produces:
  - competitive-analysis
  - market-trends
  - build-vs-buy
  - market-research-questions
consumes:
  - artifact: intent-statement
    required: true
requires_stage:
  - intent-capture
sensors:
  - required-sections
  - upstream-coverage
scopes:
  - enterprise
  - feature
  - mvp
inputs: Intent statement from intent-capture stage
outputs: competitive-analysis.md, market-trends.md, build-vs-buy.md, market-research-questions.md (under this stage's record dir, engine-resolved)
---

# Market Research & Competitive Analysis

## Steps

### Step 1: Load Prior Context

- Read intent statement from `<record>/ideation/intent-capture/`
- Identify market-relevant aspects of the initiative

<!-- BEGIN EXTERNAL OWNER ADDITION: non-overlapping research assignments -->
When delegating market research, assign only non-overlapping gaps in the existing
verified evidence. Give each assignment a distinct question, feature or competitor
boundary; reuse completed findings instead of assigning the same research again.
<!-- END EXTERNAL OWNER ADDITION: non-overlapping research assignments -->

### Step 2: Generate Clarifying Questions

Create `<record>/ideation/market-research/market-research-questions.md` with questions:
- What competing products or solutions exist in the market?
- What are their strengths, weaknesses, and pricing models?
- What industry trends or regulatory shifts are relevant?
- What do customers expect as table-stakes vs. differentiators?
- For internal initiatives: are there existing tools, SaaS products, or open-source alternatives?
- What is the build-vs-buy-vs-partner calculus?
- What market size or addressable audience are we targeting?

Follow stage-protocol.md question flow (Guide Me / Edit File / Chat).

### Step 3: Collect and Analyze Answers

Run ambiguity detection and contradiction analysis on all answers.

### Step 4: Generate Artifacts

Create competitive analysis, market trends report, build-vs-buy assessment, and differentiation strategy brief based on answers and research.

<!-- BEGIN EXTERNAL OWNER ADDITION: product-evidence; not AWS upstream -->
### Owner research requirements: competitor quality and open-source foundations

In competitive-analysis.md, list every discovered competitor and atomic feature in
an evidence-linked matrix. Record search boundaries, unknowns, restrictions, reference
behavior and quality measures; feature count alone does not establish superiority.
Show feature overlap, quality-qualified dominance, a smallest verified covering set
(label approximations), remaining threats and our missing/partial/unverified features.
Preserve the full matrix and carry gaps into scope decisions, not an automatic promise
to ship every feature in one MVP.

In build-vs-buy.md, perform a thorough, evidence-backed search for the best credible
open-source foundation for EVERY feature. Compare internal components, maintained
projects/libraries, smaller specialist projects and reusable fragments. Evaluate
combinations of projects when no single project covers the need. Record repositories,
versions, actual code/capability evidence, maintenance, security, integration effort,
quality tradeoffs and the selected foundation or combination; popularity alone is
not evidence of best fit. Research must cover credible alternatives, not stop at the
first repository or one search. State the search boundary and unresolved evidence.

Use the strongest industry implementation as the behavior/quality reference. If it is
closed-source, separately identify the best credible open-source foundation to build on.
The default product decision is to build on and adapt the selected open-source work,
not rebuild it from scratch. A reference-only implementation is an exception only after
research finds no credible reusable project, component, fragment or combination.
Even then, collect the best public behavior/design references and partial analogues.
If neither reusable code nor useful references exist, document the unsuccessful search
and surface the genuinely novel gap for the owner's scope decision; do not invent
references or claim exhaustive global novelty.

For each feature, put the selected foundation(s), exact license, integration gaps,
reference-quality acceptance targets and any justified exception in the research
handoff. Carry these selections into requirements, design, implementation units and
the code-generation plan through existing AWS artifacts. Implementation is to extend
those selected foundations. Do not replace an approved reuse decision with a fresh
implementation silently; return changed feasibility or license evidence for a scope
or design decision. Reuse verified findings rather than restarting broad research.

Read the actual licenses, including relevant dependencies and assets. Do not assume MIT.
Identify MIT notice/attribution obligations and flag non-MIT terms, especially additional
copyleft/source-sharing, network-use, patent, redistribution or commercial restrictions.
Explain implications for this product and surface unresolved or incompatible terms
before adoption. Use public or authorized references, not proprietary code or assets.

Reuse current verified research and refresh only changed or missing evidence. Write the
selected foundations, reference-quality targets and unresolved gaps into the existing
research artifacts so downstream design and implementation can use them without
repeating the full search. No new stage, custom execution engine or additional gate is introduced.
<!-- END EXTERNAL OWNER ADDITION -->

### Step 5: Completion Handoff

Hand completion to `stage-protocol.md` via
`aidlc engine orchestrate report --stage market-research --result <outcome>`.
That `report` call owns every lifecycle transition and advancement; never perform one in prose, and never narrate this bookkeeping to the user.

### Step 6: Present Completion & Request Approval

Completion emoji: :bar_chart:
Review path: `<record>/ideation/market-research/`
Standard approval gate (Approve / Request Changes).

## Sensors

This stage's outputs are markdown artefacts under `<record>/ideation/market-research/`.

Imports: `required-sections`, `upstream-coverage`.

Upstream targets: `intent-statement`.

## Learn

Follow stage-protocol.md §13: maintain `<record>/<phase>/<stage>/memory.md`
under the four standard headings while working; before the approval gate,
surface candidates with `aidlc-learnings.ts`;
still ask the mandatory "Anything to add for next time?" question, and persist confirmed selections
with the tool. The memory file stays in the artefact directory, and the stage
file remains immutable.
