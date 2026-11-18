# Document and record file download links — implementation plan

**Spec:** .ai/specs/2026-11-14-document-download-links-api.md
**Research:** none. The feature reuses Carbon's own download token and the record upload operations; there is no domain logic to research.
**Closest sibling:** the documents list loader (`routes/x+/documents+/search.tsx`) for the token; the record upload URL operations (`create*DocumentUploadUrl`) for the inputs, folders and key builder; `signItemFile` (`purchasing.service.ts`) for the signed link.
**Branch:** `feat/document-download-link-api` (stub commit `8023a042d3`)
**Run record:** .ai/runs/2026-11-14-document-download-links-api.md

## How to use this plan

- Work the tasks in order.
- 🛑 No local stack runs for this worktree. Do not start one, and do not write to a database.
- Only the main agent runs the `erp` typecheck, `pnpm generate:mcp` and `pnpm check:manifest`.

## Progress

- [x] Task 1: Add the building blocks to `documents.service.ts`
- [x] Task 2: Add `documents_getDocumentDownloadUrl`
- [x] Task 3: Add the 6 record file operations
- [x] Task 4: Add the tests
- [x] Task 5: Regenerate the manifest and run the checks
- [x] Task 6: Update the rule and the AGENTS.md files

## Task 1: Add the building blocks to `documents.service.ts`

1. Add `RECORD_FILE_URL_SECONDS = 60 * 60` above the first doc block that follows it.
2. Add `documentDownloadUrl(ctx, documentId)`:
   1. Read `document` (`id, name, path`) as the caller, with `.eq("companyId", ctx.company.id)` and `.maybeSingle()`.
   2. If the read fails, return `internal`.
   3. If no row comes back, or the row has no `path`, return `notFound`.
   4. Mint the token with `generateDownloadToken({ userId: ctx.auditUserId, companyId: ctx.company.id, documentId })`.
   5. Return `{ documentId, name, url: ${ERP_URL}${path.to.download(token)} }`.
3. Add `signRecordFileUrl(ctx, { folder, entityId, name })`:
   1. Build the key with `buildDocumentUploadPath`.
   2. Return the `refuseForeignPath` refusal when the key is not a safe key of the company.
   3. Sign the key with `storage(ctx.asSystem.supabase).company(ctx.company.id).createSignedUrl(key, RECORD_FILE_URL_SECONDS)`.
   4. If `isStorageNotFound(error)`, return `notFound`. Else, if there is no URL, return `internal`.
   5. Set the `download` search parameter to the key's last segment.
   6. Return `{ path, signedUrl, expiresIn }`.

## Task 2: Add `documents_getDocumentDownloadUrl`

1. Add the const to `documents.server.ts`, after `getDocument`.
2. Use `input: z.object({ documentId: z.string().min(1) })` and `permission: { view: "documents" }`.
3. Tag it `@mcp read`. Write a `@remarks` that names the user the token names, the missing expiry and the route that serves the link.

## Task 3: Add the 6 record file operations

Each operation goes after its upload sibling. Each one calls `signRecordFileUrl` from `~/modules/documents/documents.service`.

| File | Const | Input | Folder | Permission |
|---|---|---|---|---|
| `items.server.ts` | `getItemDocumentDownloadUrl` | `itemId`, `name` | `parts` | `{ view: "parts" }` |
| `production.server.ts` | `getJobDocumentDownloadUrl` | `jobId`, `name` | `job` | `{ view: "production" }` |
| `sales.server.ts` | `getOpportunityDocumentDownloadUrl` | `opportunityId`, `name` | `opportunity` | `{ view: "sales" }` |
| `sales.server.ts` | `getOpportunityLineDocumentDownloadUrl` | `lineId`, `name` | `opportunity-line` | `{ view: "sales" }` |
| `purchasing.server.ts` | `getSupplierInteractionDocumentDownloadUrl` | `interactionId`, `name` | `supplier-interaction` | `{ view: "purchasing" }` |
| `purchasing.server.ts` | `getSupplierInteractionLineDocumentDownloadUrl` | `lineId`, `name` | `supplier-interaction-line` | `{ view: "purchasing" }` |

## Task 4: Add the tests

1. Create `apps/erp/test/document-download-links.test.ts`. It runs with no database.
   1. For each of the 7 operations, a key without the module's view scope gets `forbidden`.
   2. A stateful in-memory caller client holds 2 `document` rows in 2 companies and applies the `eq` filters.
   3. A document the caller cannot read gets `notFound`.
   4. A document of another company gets `notFound`, although the client returns it.
   5. A document with no file gets `notFound`.
   6. The link's token verifies to the caller's company, the document and the key's creator.
2. Create `packages/auth/src/lib/download-token.server.test.ts`.
   1. A minted token verifies to the payload it was minted with.
   2. A token whose payload names another company, with the signature kept, does not verify.
3. Run the 2 files, then `apps/erp/test/mcp-tool-permissions.test.ts` against the regenerated manifest.

## Task 5: Regenerate the manifest and run the checks

1. Run `pnpm generate:mcp`.
2. Confirm 7 new READ lines in `tool-manifest.digest.json`, and that no tool name disappears.
3. Run `pnpm check:manifest`.
4. Run `pnpm exec turbo run typecheck --filter=erp`.
5. Run `pnpm exec turbo run typecheck --filter=@carbon/auth`.
6. Run `pnpm exec biome check` on the changed files.
7. Run `pnpm --filter @carbon/checks license-headers` for the new files.

## Task 6: Update the rule and the AGENTS.md files

1. Add a "File downloads" section after "File uploads" in `.claude/rules/mcp-tools-reference.md`.
2. Add each record operation beside its upload sibling in the AGENTS.md of `items`, `production`, `sales` and `purchasing`. The `documents` module has no AGENTS.md.
3. Add one paragraph about the API links to the Search section of `docs/content/docs/reference/documents.mdx`.
