---
paths: []
triggers: []
promoted: null
---
# An event sent at commit races every write the caller makes after the insert

**Context:** New `modelUpload` rows start `model-optimize` from a statement handler, and pg_net sends the event when the transaction commits.

**Problem:** The part and tool forms inserted the row and uploaded the file at the same time (`Promise.all`). The quote drop inserted the row, then staged the file. In both, the optimise could start before its file existed and fail as "file not found".

**Rule:** When an insert starts a job, finish everything that job reads before the insert: stage the file, then insert the row. Keep a backstop for an event that is lost (the reaper resends the start once).

**Applies to:** any table whose statement handler or interceptor sends an Inngest event.
