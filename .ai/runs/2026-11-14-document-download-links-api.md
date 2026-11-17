# Feature run: document and record file download links over the API and MCP

- Date: 2026-11-14
- Mode: autonomous (dev queue build agent). The decisions below were taken without a human gate and are listed for review.
- Request: an API or MCP caller can upload a document and a record's file, but cannot download either. Add `documents_getDocumentDownloadUrl` and a companion for record files. Return a link, never the bytes.
- Spec: .ai/specs/2026-11-14-document-download-links-api.md
- Plan: .ai/plans/2026-11-14-document-download-links-api.md
- Branch: `feat/document-download-link-api`, on the stub commit `8023a042d3` (base `c317d0fae9`). No merge of `origin/main`: nothing conflicts and nothing needs newer code.
- Phase plan: research [skip — no domain logic] · spec [run] · plan [run] · execute [run] · test [run, no local stack] · self-review [not run]

## Decisions

- The document token names `ctx.auditUserId`. For an API key, `auditUserIdOf` (`packages/api/src/service-fn.server.ts`) returns the key's creator.
- The document link keeps the token's missing expiry, as the documents list does.
- A record file link lasts 3600 seconds. The app's file route streams to a session and has no link, so it has no expiry to copy. The hour copies the supplier quote share page (`signItemFile(…, 3600)`).
- One operation per record upload operation, 6 in total, the line types included. Each gates on its module's view permission.
- The service role signs a record file link after the gate, because an API key is no storage user.

## Phase log

- Spec and plan written 2026-11-14. STE-80 pass done.
- Execute, 2026-11-14:
  - `documents.service.ts`: `documentDownloadUrl`, `RECORD_FILE_URL_SECONDS` (renamed `FILE_LINK_SECONDS` on 2026-11-18), `signRecordFileUrl`.
  - 7 operations in `documents`, `items`, `production`, `sales` and `purchasing`.
  - Tests: `apps/erp/test/document-download-links.test.ts` (14 cases, no database) and `packages/auth/src/lib/download-token.server.test.ts` (2 cases).
  - Red check: without `.eq("companyId", ctx.company.id)` in `documentDownloadUrl`, the case "refuses another company's document although the caller's client returns it" fails. The filter was put back.
  - `pnpm generate:mcp`: 1816 tools (1809 before), 7 new READ lines in `tool-manifest.digest.json`, no tool removed.
  - `pnpm check:manifest`: digest current.
  - `pnpm exec turbo run typecheck --filter=erp`: pass (18 minutes). `--filter=@carbon/auth`: pass.
  - Tests: the 2 new files, `mcp-tool-permissions`, `mcp-service-fn-metadata`, `mcp-manifest-cache-inputs`, `service-fn-api-key-gates`, the MCP `lib` tests, the documents, items, sales, purchasing and platform operation tests, `@carbon/auth`, `@carbon/content` and the `@carbon/checks` conformance gate: all pass.
  - Docs: `mcp-tools-reference.md` (File downloads), 4 module AGENTS.md files, `docs/content/docs/reference/documents.mdx`.

## Not tested

- No local stack ran for this worktree. These paths were not run for real: the PostgREST read under RLS, the storage signature, and a download through `download.$token.tsx`.

## Outcome

- Implemented on the branch. The self-test steps are in the dev queue report.

## 2026-11-18: document links expire

- Self-test on a local stack (2026-11-17): a document link minted with an API key still downloaded after the key was deleted, because the token names the key's creator.
- Change: `generateDownloadToken` takes `{ expiresInSeconds }`; `verifyDownloadToken` throws `DownloadTokenExpiredError` past it; `download.$token.tsx` sends that to `/download/error?reason=expired`, which has its own message. `documentDownloadUrl` mints with `FILE_LINK_SECONDS` (3600, the record-file constant renamed) and returns `expiresIn`. The documents list's tokens are unchanged (no expiry).
- Tests: `download-token.server.test.ts` (expires on time; no expiry still verifies years later), `document-download-links.test.ts` (the document link stops working after an hour; red with the expiry removed).
