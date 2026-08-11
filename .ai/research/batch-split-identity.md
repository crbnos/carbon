# Batch split identity — how ERPs keep lot identity stable across partial draws

> Desk research (model knowledge, no live browsing), 2026-08-04. Grounding: Carbon's
> tracked-entity model read directly from source the same day (`post-picking`, `issue`,
> `post-stock-transfer`, `post-shipment` edge functions; `.claude/rules/traceability-model.md`).
> Purpose: inform `.ai/specs/2026-08-04-batch-split-identity-flip.md`.

## The question

When a batch/lot is partially picked/consumed/transferred, which side of the split keeps
the existing identity — the portion that leaves, or the portion that stays on the shelf?
And should the remainder be a new record at all?

## Industry consensus: the lot number IS the identity; stock is quantity-per-(lot, location)

| System | Model | Partial draw behavior |
|---|---|---|
| SAP ECC/S4 (Batch Management) | `Batch` is master data (MCHA/MCH1); stock = quantity per (material, batch, storage location) in stock tables | Goods issue/transfer posts quantity movements against the SAME batch. No new batch record, no "split" event. Genealogy = goods-issue postings to orders (batch where-used list). |
| Dynamics 365 SCM | Batch number + license plate; on-hand = quantity per (batch, warehouse/location dims) | Picking part of a batch never mints a new batch id. Work/transactions carry quantities. |
| Business Central | Lot No. on item ledger entries; on-hand per lot = Σ ledger | Partial consumption = negative item-ledger entry with the same Lot No. Lot identity immutable. |
| Odoo | `stock.lot` (identity) + `stock.quant` = quantity per (lot, location) | Moves shift quantity between quants of the SAME lot; quants merge automatically per (lot, location). Closest structural analogue to Carbon's proposal #2. |
| Katana / Fishbowl (SMB MES) | Lot/batch record + per-location quantities | Same pattern: identity stable, quantities move. |

Nobody in this set fragments a lot into new identity records on partial draws. "Split" as
a genealogy event does not exist in these systems for batches — the traceability edge is
the consumption/issue posting itself: (order, lot, quantity). Lot splits with new
identities appear only in niche flows (e.g. SAP batch derivation / re-labeling, D365
"batch merge/split" as an explicit user action creating a NEW batch number deliberately —
i.e. a physical re-identification, not bookkeeping).

Implication for Carbon: fragments carry zero traceability information for a homogeneous
batch — kg within a lot are indistinguishable, so per-fragment identity is pure
bookkeeping overhead. Serials are the qty-1 degenerate case and never split.

## Carbon today (verified in source, 2026-08-04)

`trackedEntity` = identity + quantity + status in one row; picking allocation
(`pickingListLineTrackedEntity`), consumption status, and genealogy edges all key on the
row id. Split writers (`post-picking` batch case, `issue` ×2, `post-stock-transfer`,
`post-shipment`) all implement the same convention:

- ORIGINAL id follows the DEPARTING portion (quantity overwritten to the transfer/consume
  amount); attribute `Split Entity ID` → new remainder id.
- NEW nanoid minted for the REMAINDER that stays on the shelf.
- Split activity records the original as BOTH input (full pre-split qty) AND output
  (departing qty), remainder as second output.

Consequences observed on a live tenant (Zero Farms): shelf lot's internal id churns on
every draw → stale physical labels/QR (the shelf bag's label points at the entity that
left), Storage Units UI shows N indistinguishable rows per lot, traceability graph is a
chain of renamed remainders + one Split diamond per draw, activity feed renders the split
ledger triplet (−full/+kept/+remainder) as phantom "adjustments", and returns never merge
(fragment count grows monotonically).

## Decision already taken by the team (Slack, May 15 + Jul 21 2026)

Brad Barbin: "during a split — existing batch stays on shelf with updated quantity, new
batch gets consumed by job." Davide + Umberto + Sid concurred (fixes label reprint,
bidirectional trace). Believed implemented; verified 2026-08-04 it never was — code still
does the inverse.

This is the *inverse-identity* variant of the industry model: keep the entity abstraction,
but pin the identity to the shelf stock (like SAP's batch+storage-location bucket) and
mint short-lived ids only for departing portions that are immediately consumed/shipped.
Combined with merge-on-return it converges on Odoo's quant behavior for the shelf side
while preserving Carbon's per-entity genealogy edges.

## Takeaways for the spec

1. Flip all four split writers: shelf keeps id + decremented quantity; departing portion
   = new entity (which the pick allocates / job consumes / shipment ships).
2. Split activity edges: shelf entity = input (drawn qty), departing entity = output
   (drawn qty). Recording the shelf entity also as an output (survivor self-loop) is what
   makes the UI claim a received lot was "Produced by Split" — drop it or filter it.
3. Returns should merge quantity back into the shelf entity (id now stable, same lot) —
   the industry systems have no fragment to return; merging is the equivalent.
4. History: existing fragments stay; convention applies going forward (matches how SAP
   handles convention changes — no retroactive re-identification).
