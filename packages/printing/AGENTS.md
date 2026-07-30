# @carbon/printing

Print job system — printer routing, label generation queue, ProxyBox delivery, and printing UI components.

## Always

- **Three exports**: `.` (registry, validators, assignments, DB services, types), `./printing.server` (cache, ProxyBox delivery, BinderyPress rendering), `./ui` (PrintingProvider, PrintButton, LabelDownloadModal).
- **Invalidate Redis cache after printer changes** — call `invalidatePrinterCache(companyId)` after any `printerRoute` upsert/delete or assignment update. Cache key: `printing:{companyId}:{locationId}:{context}`.
- **Follow the enqueue pattern**: `trigger("print-job", { sourceDocument, sourceDocumentId, companyId, userId, locationId?, workCenterId? })` from `@carbon/lib`. Both manual and auto-print paths use the same Inngest task.
- **Wrap auto-print in try/catch** — check `getCachedPrinterConfig(...).autoPrint`, never let print failures block the parent business operation.

## Ask First

- Adding a new `sourceDocument` type to the registry (`packages/printing/src/registry.ts`)
- Changing printer assignment resolution logic (`assignments.ts` — shared by server cache and client `usePrinting`)
- Adding new document renderers (coordinate with `@carbon/documents`)

## Never

- Set `retries > 0` on print Inngest functions — delivery timeouts are intentionally non-retriable to avoid duplicate physical prints
- Import `./printing.server` in client/browser code — it's server-only (Redis, ProxyBox HTTP calls)
- Skip the 30s auto-dedupe check for `origin="auto"` jobs

## Validation Commands

```bash
pnpm --filter @carbon/printing typecheck
pnpm --filter @carbon/printing lint
```

## Key Patterns

```typescript
// Registry
import { getDocumentTypesForSource, documentTypeRegistry } from "@carbon/printing";

// Assignments & routing
import { resolveContextAssignment, getPrinterContextForSource, printerContexts } from "@carbon/printing";
// Contexts: default | shipping | receiving | inventory | workCenter

// Server
import { getCachedPrinterConfig, invalidatePrinterCache, sendToProxyBox } from "@carbon/printing/printing.server";

// UI (in app layout)
import { PrintingProvider, PrintButton } from "@carbon/printing/ui";
```

## Architecture

1. **Enqueue** → `trigger("print-job", payload)` fires Inngest event
2. **Generate** → `print-job/index.tsx` resolves printer config, renders PDF/ZPL (built-in or BinderyPress template), creates `printJob` rows
3. **Deliver** → `print-job-deliver.ts` sends content to ProxyBox printer endpoint
4. **Status**: `generating → queued → printing → completed | failed`

## Cross-References

- `.claude/rules/printing-system.md` — full architecture, request flow, gotchas
- `@carbon/documents` — PDF (`@react-pdf/renderer`) and ZPL renderers
- `packages/jobs/src/inngest/functions/tasks/print-job/` — Inngest generate/deliver functions
- `apps/{erp,mes}/app/routes/x+/print.tsx` — manual print route
- `apps/erp/app/routes/x+/settings+/printing.tsx` — printer settings UI
