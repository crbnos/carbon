# Writing guide

How to write Carbon docs so the prose earns the design. The voice is deliberate — opinionated, concrete,
second-person — not the flat neutral tone most docs default to. But before any of that:

## Rule 0 — ground every claim in source (non-negotiable)

The holy source of truth is **the actual source code + the LATEST database migrations**, never ERP-generic
knowledge, never `.claude/rules/` alone. A confidently-wrong sentence is worse than no sentence.

- **Verify before writing.** Every entity, **status enum value** (exact string), and **transition** must
  exist in real code. Dispatch a research subagent → get `file:line` refs → then write.
- **Newest migration wins.** Read by timestamp, newest first; a 2026 refactor may have rebuilt the subsystem.
- **Only real, ACTIVE features.** Omit placeholders / `active: false` / not-yet-shipped. Don't tease a flow
  that won't exist.
- **Carbon is specific and counterintuitive** — that specificity *is* the value. The best sentences are the
  ones a generic ERP guide would get wrong: "WIP isn't a table — it's a GL balance"; "payment is a field,
  not an entity"; "overhead is not absorbed into job cost"; "disposal is scrapping-only, always a loss."

## The voice in three moves

Almost every good section makes the same three moves:

1. **Say what actually matters** — lead with the real point, no preamble.
2. **Name the mistake** — call out what people get wrong, specifically. Often the highest-value sentence.
3. **Show how Carbon handles it** — bridge to the concrete behavior.

Opinionated, concrete, second person. ✓ "You don't build 90 robots as one monolithic job." Not ✗ "Jobs
can be split into batches."

## Voice principles

- **Second person, active, present tense.** "You create a shipment against the order." Not "A shipment is created."
- **Lead with the point.** First sentence of each `##` states the takeaway; a reader who stops there still learns the main thing.
- **Anchor in a running example.** The Guides follow one shop — an OEM building humanoid robots, a 90-unit
  order split 30/30/30. Reuse concrete nouns and numbers; they make abstract mechanics legible.
- **Quote real status names exactly, in bold-quotes.** `**"To Ship and Invoice"**`, `**"Posted"**`,
  `**"Fully Depreciated"**`, `**"Open"**`. These are verified strings — getting one wrong reads as not
  knowing the product.
- **Name the common mistake.** Say the thing people trip on out loud.
- **Short paragraphs** (2–4 sentences, one idea). White space is part of the writing.
- **Plain words.** "make" not "utilize", "use" not "leverage". Technical terms are exact and consistent.
- **Respect the reader's time.** No "In this section we will…" throat-clearing, no restating the heading.

## Terminology: one word per concept

Match the **ERP/MES UI labels and the verified code** — same word for the same thing everywhere. A *work
order* is not a *job* is not an *operation*. Method types are exactly `Make to Order` / `Pull from Inventory`
/ `Purchase to Order` (not "Make/Buy/Pull"). Before a chapter, list its domain nouns and pin each to the
real term. Inconsistent terminology is the fastest way to lose trust.

## Callouts carry the gotcha

A `<Callout>` is where the counterintuitive Carbon truth lives — the title is a claim, the body is the why.
Don't waste them on restating prose. 2–4 per Guide chapter; if every paragraph is a callout, none land.

```mdx
<Callout tone="neutral" badge="NO RIGID CHAIN" title="Quotes are optional — the opportunity is the thread.">
A sales order does not require a quote, and a quote does not require an RFQ. Each document links back to the
same opportunity, so you can enter the flow at whatever point a deal actually starts.
</Callout>
```

## Interlink at the seams

Two mechanisms, both every time you touch a page:

- **Markdown links carry *navigation*.** Link the *noun*, inline — never "click here". A Guide links into
  Reference for fields; Reference links back to the Guide for the story
  (`[make-to-order tour](/guides/order)`, `[quote-to-cash](/guides/order-to-cash)`).
- **`<Term>` carries *definitions*.** Wrap a term a reader hits cold (method type, replenishment system, WIP,
  outside operation…) so a click glosses it in place. First occurrence per page only; definitions live in
  `docs/lib/glossary.ts`, grounded in source — add the entry before you use a new term.

When you create or edit a page, end with an **enrichment pass**: gloss first-occurrence jargon with `<Term>`,
add cross-links at the seams, top up the glossary. Internal linking compounds — make it a habit.

## Real page templates

### Guide chapter (editorial, in a flow)
```mdx
---
title: From quote to order
description: An RFQ becomes a quote; an accepted quote becomes a sales order.
label: "(I)"
index: 0
flow: quote-to-cash
flowName: Quote to cash
flowIndex: 1
---

## Introduction

The make-to-order tour started at a confirmed sales order. This flow rewinds to where that order comes
from: a customer asking for a price, a quote that answers it, an acceptance that turns it into work.

## One opportunity, many documents

In Carbon, an RFQ, a quote, and a sales order aren't a rigid chain — they hang off a single **opportunity**…

<Callout tone="neutral" badge="NO RIGID CHAIN" title="Quotes are optional — the opportunity is the thread.">
…
</Callout>

<Screenshot label="Quote builder" caption="A multi-line quote with quantity-break pricing." ratio="wide" />
```
Each chapter ends pointing onward (the reader auto-gets a "read next" within the flow); the final chapter of
a flow ends with a `<Divider />` + one wrap-up line.

### Reference (entity page)
```mdx
---
title: Sales orders
description: The confirmed customer order that production, shipment, and invoicing all key off.
---

A **sales order** is … (lead with what it is and why it's load-bearing).

## Statuses

| Status | Meaning |
|---|---|
| `Draft` | … |
| `To Ship and Invoice` | open until every line is both shipped and invoiced |

<Callout type="note">The list shows a computed **display status** that can read `In Progress` while the stored status is `To Ship and Invoice` — make-to-order lines with open jobs.</Callout>

<Cards>
  <Card title="Ship, invoice, get paid" href="/guides/order-to-cash">The story of fulfilling this order.</Card>
</Cards>
```

## The "earn its place" test

Before shipping a page, read it as a Carbon newcomer. Each paragraph must **teach**, **warn**, or **move
forward** — cut anything that does none. Then the page as a whole:
- First paragraph states what matters?
- Common mistake named?
- Clear next step / link at the end?
- Could a real example replace an abstract sentence? Replace it.
- **Every status/name/transition checked against source?** (Rule 0.)
- **Jargon glossed, seams linked?** First-use terms wrapped in `<Term>` (entry in `lib/glossary.ts`), cross-links added.
- **Visuals show the real UI?** Each `<Screenshot>` marks a real, current Carbon screen (grounded label), placed where the reader needs to see it — not decoration.

## Tone calibration

You're writing to manufacturers, shop managers, and the engineers configuring their system. Sound like a
sharp manufacturing-systems consultant who has set up a hundred shops and knows exactly where they go wrong:
confident, concrete, never padded, never condescending — and never guessing about how Carbon actually behaves.
