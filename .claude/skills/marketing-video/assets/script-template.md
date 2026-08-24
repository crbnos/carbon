# {FEATURE} — demo video script ({YYYY-MM-DD})

Clueso project: {URL once created}
Company: {demo company} · Voice: {one voice, e.g. Jeff / ElevenLabs}

## Grounded facts (verified — every on-screen number traces here)

<!-- FILL: pull each from the DB/source, not from memory. Example shape: -->
- Customer / party: {name} ({id})
- Item: {readableId — {name}} · tracking: {Serial|Batch|Inventory}
- Source doc: {order} / {shipment}, qty {n} at unit price {settlement-formatted}

<!-- ACCOUNTING FEATURES ONLY — delete this block if the feature posts no GL.
     For a non-accounting feature the "payoff" is a resulting STATE
     (status flip, records linked, a document produced), not a journal. -->
- Original cost: {from cost layers} to re-entry/relief value {figure}
- Posted journal ({sourceType}): {account} {debit} / {account} {credit}  (from DB)
- Settlement figure on the payoff card: {figure}  (MUST equal the posted line)

## Act 0 — Cold open ({~0:00–0:12})  · designed slide / UI scene
On screen: {the pain — a mail scene / request}
VO: "{one or two sentences, human, specific, with the number}"

## Act 1 — The map ({~0:12–0:25})  · designed slide
On screen: {N scattered places today} to {one place: the FEATURE / acronym intro}
VO: "{…handled in one place: the {Full Name}, or {ACRONYM}.}"

## Act 2 — The flow  · SCREEN RECORDING, phases
<!-- one row per recorded phase; each becomes a shot list + a cut -->
| Phase | Beats (click → business meaning) | ~len |
|-------|----------------------------------|------|
| P1 {name} | {…} | {s} |
| P2 {name} | {…} | {s} |

Per-phase VO (human sentences, each action states its meaning):
- P1: "{…}"
- P2: "{…}"

## Act 3 — The payoff ({~1:45–2:25})  · designed cards
<!-- one card per moment. ACCOUNTING features: the cards are the posted journal
     lines, figures copied from Grounded facts (never recomputed). NON-accounting
     features: the cards are the resulting STATE — status flip, records linked, a
     document/PDF produced, an entity's history intact. Same card treatment. -->
| Card | On screen | VO |
|------|-----------|----|
| {step} | {`Dr … / Cr …`  — or, non-accounting: the result state} | "{what it means}" |

## Act 4 — Close ({~2:25–end})  · designed slide
On screen: {one-line reconciliation / outcome} to {Product name end card}
VO: "{the payoff in one line. Accounting close, e.g. '…nobody typed any of it.
The document did.' — for a non-accounting feature, land the outcome instead
('…one record, start to finish'). Don't imply GL that didn't post.}"

## Build log
<!-- clip list, ids, decisions, and any product defects the video exposed -->

## Open / not done
<!-- reviewer notes deferred, data gaps, reshoots pending -->
