# P1 Product Identity

## Identity rule

The authenticated experience is presented as **Factory OS**. The implementation
still runs in the existing Carbon ERP application and keeps company-provided
logos in the Topbar. P1 does not invent a new customer logo or overwrite tenant
branding.

## Implemented surface

- The shell navigation carries a compact `FO / Factory OS` identity mark.
- The document title is `Factory OS` (and `Factory OS | Error` for the root error
  boundary).
- Existing company logo, company switcher, avatar, and Carbon module labels remain
  intact so tenant and legacy context are not lost.
- Environment indicators, when supplied by the existing Carbon runtime, remain
  unchanged; P1 adds no new environment signal.

## Product relationship

ERPNext remains the system of record. Carbon MES remains the execution system.
Factory OS is the industrial experience, ontology, AI decision, and governance
layer. P1 changes presentation and navigation only; it does not claim ownership
of ERPNext or MES records.
