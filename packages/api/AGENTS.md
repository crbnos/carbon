# @carbon/api

The Carbon API contract layer: the types for the generated operation manifest, and
the Standard-Schema wrapper that lets oRPC carry precomputed JSON Schemas without a
zod round-trip. Internal workspace package — never published to npm.

## Always

- Treat `ManifestEntry` as the shape of the GENERATED manifest — the data itself is
  the erp app's gitignored `routes/api+/mcp+/lib/tool-metadata.json`, produced by
  `pnpm generate:mcp` (turbo root task `//#generate:mcp`; `typecheck`/`build`/`test`
  depend on it). Change the generator (`scripts/lib/service-metadata.ts`) and these
  types together.
- Keep `jsonSchema()` a pass-through validator (never rejects). It is the **output**
  wrapper: `shapeHttpBody` rewrites the HTTP body, so a correct response does not
  match the operation's declared response schema and validating it would reject
  real responses.
- `jsonSchemaInput()` is the **input** wrapper and DOES validate, via
  `z.fromJSONSchema` (zod is already a workspace dependency — no Ajv, no
  JSON-Schema validator library). Keep it permissive in the two ways the
  dispatcher depends on: unknown keys are preserved, not stripped, and a lone
  required wrapper's contents may be sent flat (the workflow engine's
  `job.create` sends `insertJob`'s inner fields at the top level). An
  unconvertible schema falls back to pass-through rather than failing every
  request to that operation.
- Keep `@orpc/openapi` imports in `schema.ts` type-only — it is a devDependency, and
  the runtime module must not pull it in.

## Never

- Hand-edit `tool-metadata.json` or `tool-manifest.digest.json` — both are generated;
  `pnpm check:manifest` (pre-commit gated) fails on a stale digest.
- Add runtime dependencies beyond the `@orpc/*` client-side packages without asking.

## Validation Commands

```bash
pnpm exec turbo run typecheck --filter=@carbon/api
pnpm run check:manifest        # digest current?
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` (index) | Manifest types: `ManifestEntry`, `ToolPermission`, `Classification`, `AuthField`, `PermissionAction` (re-exports `./schema` too) |
| `./schema` | `jsonSchema()` pass-through Standard Schema wrapper, `CarbonJsonSchemaConverter` (OpenAPI generator plugin), `CARBON_VENDOR` |

## Consumers

- `apps/erp/app/routes/api+/v1+/lib/` — the oRPC router/dispatch/gate read
  `ManifestEntry` and build procedures with `jsonSchema()`.
- `scripts/lib/service-metadata.ts` + `scripts/lib/manifest-digest.ts` — the
  generator emits entries in this shape and hashes them for the digest.

## Cross-References

- `.claude/rules/mcp-tools-reference.md` — the manifest/generator/dispatch pipeline
- `.ai/plans/2026-09-07-orpc-completion.md` — D1 records why the manifest is one
  file here rather than per-module shards (deferred, with revisit triggers)
