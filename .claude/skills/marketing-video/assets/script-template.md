# {FEATURE} — demo video script ({YYYY-MM-DD})

Clueso project: {URL once created}
Company: {demo company} · Voice: {one voice, e.g. Jeff / ElevenLabs}

## Grounded facts (verified — every on-screen number traces here)

<!-- FILL: pull each from the DB/source, not from memory. Example shape: -->
- Customer: {name} ({customerId})
- Item: {readableId — {name}} · tracking: {Serial|Batch|Inventory}
- Source doc: {order} / {shipment}, qty {n} at unit price {settlement-formatted}
- Original cost: {from cost layers} → re-entry/relief value {figure}
- Posted journal ({sourceType}): {account} {debit} / {account} {credit}  ← from DB
- Settlement figure on the payoff card: {figure}  ← MUST equal the posted line

## Act 0 — Cold open ({~0:00–0:12})  · designed slide / UI scene
On screen: {the pain — a mail scene / request}
VO: "{one or two sentences, human, specific, with the number}"

## Act 1 — The map ({~0:12–0:25})  · designed slide
On screen: {N scattered places today} → {one place: the FEATURE / acronym intro}
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
<!-- one card per moment; figures copied from Grounded facts, not recomputed -->
| Card | On screen | VO |
|------|-----------|----|
| {step} | {`Dr … / Cr …` or result} | "{what it means}" |

## Act 4 — Close ({~2:25–end})  · designed slide
On screen: {one-line reconciliation} → {Product name end card}
VO: "{…nobody typed any of it. The document did.}"

## Build log
<!-- clip list, ids, decisions, and any product defects the video exposed -->

## Open / not done
<!-- reviewer notes deferred, data gaps, reshoots pending -->
