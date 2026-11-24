---
paths: []
triggers: []
promoted: null
---
# Accounting review: carrying balances and source principal

- **Context:** Mixed positive and negative invoice lines, high FX rates, and changes to account defaults during settlement and provider replay.
- **Problem:** Summing control magnitudes invented FX; recovering document units from rounded base lost valid minor-unit balances; current defaults rewrote original account provenance.
- **Rule:** Sum signed original control amounts, preserve exact document principal independently of carrying base, and identify original journal roles through the shared exhaustive vocabulary (including intercompany roles). Reject unknown effective principal rather than infer it; retain Draft reservation policy separately from Posted effectiveness.
- **Applies to:** Invoice/payment/memo posting, open-balance readers, and accounting provider replay.
