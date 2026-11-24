---
paths: []
triggers: []
promoted: null
---
# Browser code must import `@carbon/documents/utils`, never `@carbon/documents/pdf`

**Context:** Adding a shared `getQuoteDisplayId` / `getPurchaseOrderDisplayId` helper for showing the revision suffix on documents. The natural home looked like the `./pdf` barrel, which already re-exported it for the server-side PDF routes.

**Problem:** `./pdf` is a barrel over every `@react-pdf/renderer` document component. A route `loader`/`action` can import from it safely — React Router strips server-only exports and tree-shakes the rest — but a **client-rendered component** cannot: the `/share/**` quote page and the ERP UI would pull the entire react-pdf graph into the browser bundle for a five-line string helper. The existing convention confirms this: ERP client components only ever import `@carbon/documents/template`, never `/pdf`.

**Rule:** Pure display helpers shared by server and browser belong in `packages/documents/src/utils/` and are exposed through the `./utils` export (type-only deps). Import them from `@carbon/documents/utils` in any component that renders in the browser. `src/utils/index.ts` is an explicit re-export list, not `export *` — the per-document util files each define their own `getLineDescription`, so a wildcard barrel collides.

**Applies to:** `packages/documents/package.json` exports, `packages/documents/src/utils/index.ts`, any `@carbon/documents` import inside `apps/erp/app/modules/**/ui/**` or `apps/erp/app/routes/share+/**`.
