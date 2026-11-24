---
paths: []
triggers: []
promoted: null
---
# Chained Supabase writes in a route action are not a transaction

**Context:** RFQ finalize and supplier quote finalize each wrote a quote, its lines, a share link and a price list as separate `client.from(...)` calls in a loop, logging and skipping any that failed.

**Problem:** Every statement was its own PostgREST request (about 34 ms each), and a failure partway left quotes without lines or half a price list while the action still reported success. The checks that made the write safe (every line priced, the RFQ still Draft) lived in the route, so the API tool for the same operation skipped them.

**Rule:** A write that spans tables is a posting (a building block in its module's `<module>.service.ts`) with one Kysely transaction. Its preconditions are checked inside it, on a locked read of the document (`forUpdate()`), so a double submit and every other caller get the same answer. The route keeps only what is about the request: the form, the flash, the email.

**Applies to:** any route action with more than one write; `finalize-purchasing-rfq`, `finalize-supplier-quote`.
