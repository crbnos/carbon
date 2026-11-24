---
paths: ["apps/mes/app/components/JobOperation/**"]
triggers: ["BatchCompleteModal"]
promoted: null
---
# A post-success prompt must not live in the component the success unmounts

**Context:** MES batch completion. `BatchCompleteModal` submitted the completion and was meant to swap itself for a "merge these lots?" prompt when the action returned one.

**Problem:** The modal is rendered `{batch && batchCompleteModal.isOpen && …}`, and `batch` is only passed by the loader while the batch is `Active`/`Completing`. Completing it — the very thing that produces the prompt — revalidates the loader, `batch` becomes null, and the modal unmounts with its `useFetcher` still holding the response. The prompt could never render, and the symptom was indistinguishable from the server never sending it (the page just sat there, because a `data()` reply does not navigate).

**Rule:** When an action's response drives UI that appears AFTER success, own the fetcher in a component that outlives the state change — here `JobOperation`, passing the fetcher down into the modal and rendering the prompt itself, ungated by `batch`. Before wiring a post-success view, ask which component the success unmounts.

**Applies to:** MES `JobOperation` + `BatchCompleteModal`/`BatchMergePrompt`; any modal gated on loader data that its own submit invalidates.
