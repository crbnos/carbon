---
paths: []
triggers: []
promoted: null
---
# Never build PostgREST `.or()` filter strings from external values

**Context:** Mapping-row deletes used `.or(`entityId.eq.${id},externalId.eq.${externalId}`)` where `externalId` embeds an Onshape part number.

**Problem:** A part number containing `,` or `(` `)` changes the filter's meaning — the value is interpolated into PostgREST's filter grammar unquoted, so the delete can match other rows or fail. Every `.in()` / `.eq()` call passes values as parameters and is immune.

**Rule:** Use `.eq()` / `.in()` instead of a hand-built `.or()` string whenever any operand comes from outside Carbon (CAD part numbers, external ids, user text). Chained filters on one query are AND-ed, so an OR across two columns ("remove mappings matching `entityId` OR `externalId`") becomes one parameterized statement PER COLUMN — two separate deletes — never both filters chained onto one delete, which removes only rows matching both and leaves the conflicting row that the next insert trips over.

**Applies to:** every Supabase client call with `.or(` whose operands are not literals; `apps/erp/app/routes/api+/integrations.onshape.*`.
