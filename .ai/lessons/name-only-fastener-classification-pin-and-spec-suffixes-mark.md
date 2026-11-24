---
paths: []
triggers: []
promoted: null
---
# Name-only fastener classification: "pin" and spec suffixes mark structure as hardware

**Context:** The SA BCU's enclosure is named "Electronics Box - 36 Pin" (a connector pin COUNT). The fastener name regex matched `\bpin\b`, classifying the box as hardware: removal priority fronted it (fasteners first → expensive failed sweeps → flagged early), base candidacy excluded it, and the assembly sequence anchored on a gasket. One word in a part name inverted the entire build order.

**Problem:** Fastener detection is name-only; real CAD names carry fastener-ish tokens in structural parts (pin counts, "M8 slot pattern" spec suffixes). A false positive is fail-open: it changes scheduling, exemptions, and base selection everywhere at once.

**Rule:** Never classify on ambiguous single tokens — "pin" is out (dowel pins still match via "dowel"). Back the name test with physical sanity in `_classify_fasteners`: a name-matched part spanning more than `max(100mm, 0.35 × assembly diagonal)` keeps its structural role. When ordering goes absurd on a new model, print the `fasteners` cohort first — one misclassified structural part explains a scrambled sequence.

**Applies to:** `crates/planner/src` (`FASTENER_NAME_RE`, `_classify_fasteners`, `removal_priority`, `_reselect_base`); future classification heuristics.
