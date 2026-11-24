---
paths: ["packages/jobs/src/inngest/**"]
triggers: ["NonRetriableError", "RetryAfterError", "AssemblerJobError"]
promoted: null
---
# A `NonRetriableError` subclass must keep its name

**Context:** `AssemblerJobError extends NonRetriableError` (`packages/jobs/.../tasks/assembler-client.ts`) set `this.name = "AssemblerJobError"`.

**Problem:** `@carbon/lib` (which creates the Inngest client, so runs the functions) and `@carbon/jobs` resolve different installed copies of `inngest`, so `error instanceof NonRetriableError` is false inside the SDK. Its fallback is `error.name === "NonRetriableError"`, which the rename defeated. Every "give up" error was retried twice, as 500s from `/api/inngest`, before `onFailure` ran.

**Rule:** Never set `name` on a subclass of an Inngest error class (`NonRetriableError`, `RetryAfterError`); carry what tells it apart in another field (`code`). Check it against the client's copy: `createRequire("packages/lib/package.json").resolve("inngest")`.

**Applies to:** Every error class thrown from an Inngest function in `@carbon/jobs` or `@carbon/ee`.
