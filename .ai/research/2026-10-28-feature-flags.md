# Research — feature flags for Carbon instances

Date: 2026-10-28. Spec: `.ai/specs/2026-10-28-feature-flags.md`.

## Question

A Carbon instance gets its feature flags from a URL that the operator sets,
like the OTEL exporter. The instance can be Carbon Cloud or BYOC. Which
open-source format and library fit this?

## Options surveyed

| Option | Kind | License | Fit |
|--------|------|---------|-----|
| OpenFeature SDKs (`@openfeature/server-sdk` 1.23.0, Go `go-sdk` 1.20.0) | Vendor-neutral evaluation API | Apache-2.0 | Good. A custom provider puts any backend behind one API. |
| flagd file format + `@openfeature/flagd-core` 5.0.0 (JS) / `flagd/core` 0.19.1 (Go) | Flag JSON schema and an in-process evaluation library | Apache-2.0 | Good. Both languages evaluate the same JSON. No daemon is necessary. |
| flagd daemon | A server that serves the flagd format | Apache-2.0 | Not necessary. We use the format and the library, not the daemon. |
| Flags SDK (`flags`, Vercel) | Flags declared in code with a `decide()` function | MIT | Weak. It targets Next.js and SvelteKit. Carbon uses React Router. |
| GrowthBook SDK | Local evaluation of a features JSON | MIT | Possible. It has its own format with no Go-and-JS shared standard. |
| Unleash, Flagsmith, Flipt, FeatBit, GO Feature Flag | Self-hosted flag platforms | Open source | Too much for v1. Each one is a server to run. All have OpenFeature providers, so a later move is a provider swap. |

## What we verified

1. `FlagdCore.setConfigurations(json)` and `resolveBooleanEvaluation(key, default, context)`
   exist in `@openfeature/flagd-core` 5.0.0.
2. In Go, `evaluator.NewJSON(logger, store)`, `SetState(sync.DataSync{FlagData, Source})`
   and `ResolveBooleanValue(ctx, reqID, key, context)` exist in `flagd/core` 0.19.1.
3. A scratch Go client and a scratch Node provider load the same flagd JSON.
   Both give the same answers. A targeted company gets `true`, another company
   gets `false`, and a missing flag gets the code default.
4. A scratch Go server compiles flag rules into flagd JSON per instance. It
   validates the output with the flagd evaluator before it sends it. Tests
   cover 401, 200, 304 and the removal of rules that other instances own.
5. The OTEL exporter in Carbon reads `OTEL_EXPORTER_OTLP_ENDPOINT` and
   `OTEL_EXPORTER_OTLP_HEADERS` from `process.env`
   (`packages/logger/src/tracing.server.ts`). The header format is
   `key=value` pairs, separated by commas, with percent-encoded values.

## Pitfalls found in review

| Pitfall | Mitigation |
|---------|------------|
| A cold serverless instance starts on code defaults while warm instances keep the loaded flags | Keep the last good document in Redis. Load it before the first fetch. |
| Go `url.QueryUnescape` changes `+` to a space | Use `url.PathUnescape`. Test a value with `+`, `%2C` and `=` in both languages. |
| `decodeURIComponent` throws on a bad `%` sequence | Skip the bad pair and log it. Flags never stop the app from starting. |
| Vercel pauses the process after the response | Run the background refresh through `waitUntil`. Set the next refresh time only after the fetch ends. |
| A call site without `companyId` gets the default and no error | Export a typed wrapper that requires `companyId`. |
| A large response body fills memory | Refuse a body over 1 MB. |
| A failing endpoint shows only in the logs | Expose the age of the loaded flags and the last error. |
| The first fetch blocks startup | Wait at most 2 seconds, then continue in the background. |
| Deleting a flag on the server sends every instance back to the code default | Delete the flag only after the code no longer reads it. |
| Instances that one deploy started poll at the same time | Add ±20% jitter to the 60-second interval. |

## Sources

- https://openfeature.dev
- https://flagd.dev/reference/flag-definitions/
- npm: `@openfeature/server-sdk`, `@openfeature/flagd-core`
- Go modules: `github.com/open-feature/go-sdk`, `github.com/open-feature/flagd/core`

## Later decisions (spec Q7–Q9)

After this research, the design changed in two places:

1. Only the ERP and the MES read flags. The Go client stays a reference.
2. The sources (the console and the CSA dashboard) are Node apps. Each one
   writes its own endpoint. They use the `Flag` type and the validator from
   `@openfeature/flagd-core`. `setConfigurations` throws on a bad
   `defaultVariant` or a bad `state` (checked with 5.0.0).
