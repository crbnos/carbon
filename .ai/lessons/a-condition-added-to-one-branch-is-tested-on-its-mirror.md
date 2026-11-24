---
paths: ["packages/planning/src/promising/**"]
triggers: ["checkDeliveryDates"]
promoted: null
---
# A condition added to one branch is tested on its mirror

**Context:** The delivery date check decides two things from the same free stock: whether a date passes, and the earliest date it suggests.

**Problem:** The rule "goods are usable from the day they arrive" went into the earliest date only. A date in the week of a delivery, but before it, still passed. In the same change, the whole-order check left every line it checked out of the order's demand. An undated line is never checked, so its demand disappeared and a dated line could be promised its stock.

**Rule:** For each condition you add, list every other place that decides the same thing (the verdict and the suggestion; the rows you exclude because "they are handled elsewhere" and the rows that really are handled there). Test the case that falls between them.

**Applies to:** Decision engines that return both a verdict and a suggested value, and any exclusion justified by another step.
