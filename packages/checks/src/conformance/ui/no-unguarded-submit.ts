// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";
import { openingTag, propExpression } from "../../sources/jsx-tags";
import { lineOf } from "../../sources/text";

// A submit button that stays live while its own submission is in flight posts
// again on every extra click, and each POST runs to completion on the server —
// `fetcher.submit` aborts the previous BROWSER request, but nothing in a route
// action reads `request.signal`. That is how finalizing one quote emailed the
// customer the same PDF three times (QuoteFinalizeModal, 2026-09-29): the
// action renders a PDF, uploads it, writes the document row and sends the mail,
// and for those several seconds the button was enabled and not even spinning.
//
// The repo has two correct shapes, and this check exists to keep them:
//   - inside a ValidatedForm → `<Submit>` (@carbon/form), which disables on
//     `isSubmitting`. ValidatedForm additionally refuses a re-entrant submit,
//     so buttons under one are not flagged at all (see `inValidatedForm`).
//   - inside a `fetcher.Form` / `<Form>` → `isDisabled={fetcher.state !== "idle"}`
//     plus `isLoading`, as QuoteHeader and FinalizeRFQModal do.
//
// The absent spinner matters as much as the absent disable: with no feedback,
// clicking again is the reasonable thing for a user to do.
//
// The baselined buttons were each reviewed. A second click is harmless on all
// of them:
//   - logout, company switch, theme and console toggle: idempotent.
//   - delete and rule unassign: a second delete does nothing.
//   - the two chat composers: a `flushSync` clear plus an empty-message return
//     guard them.
//   - `ConfiguratorForm`: its submit is an `onSubmit` callback, so the
//     in-flight state lives at the caller.
export const noUnguardedSubmit = defineCheck({
  files: typescript,
  id: "no-unguarded-submit",
  description:
    'A submit button must disable while its submission is in flight — use <Submit> inside a ValidatedForm, or isDisabled={fetcher.state !== "idle"} with isLoading',
  provenance: {
    deprecates:
      'raw <Button type="submit"> with no in-flight guard, which posts again on every click',
    replacedBy:
      "<Submit> from @carbon/form, or isDisabled/isLoading bound to the fetcher's state",
    since: "2026-09-30"
  },
  rule() {
    // An in-flight SIGNAL, not merely the presence of `isDisabled`. The quote bug
    // was `isDisabled={loading}`, where `loading` was the modal's data-fetch flag —
    // a check that accepted any `isDisabled` would have passed the exact line it
    // exists to catch. Word boundaries are load-bearing: `loading` must not satisfy
    // `isLoading`.
    const inFlightSignal =
      /\bisLoading\b|\bisSubmitting\b|\bisPending\b|\bisSaving\b|\buseIsSubmitting\b|\b\w*(?:fetcher|navigation|transition)\w*\.(?:state|formAction)\b/i;

    // Props that actually disable the button. Presence alone is not enough:
    // `isLoading={false}` spins nothing and disables nothing.
    const disablingProps = ["disabled", "isDisabled", "isLoading"];

    // A bare `isLoading` with no expression is `true` — permanently disabled, so
    // a second submit is impossible.
    const bareLoadingProp = /\bisLoading\s*(?:\/?>|\s+[a-zA-Z-]+\s*=|\s*$)/;

    // Match `type` at an attribute boundary, both JSX quote styles. Searching for
    // the bare text matched `data-type="submit"` on a non-submit button and missed
    // `type='submit'`.
    const submitAttr = /(?:^|[\s{])type\s*=\s*["']submit["']/;

    // Where the two guards are DEFINED. `<Submit>` renders `type="submit"` and is
    // the component this check tells everyone else to use.
    const excludedFiles = new Set(["packages/form/src/components/Submit.tsx"]);

    const openTag = /<(Button|button|IconButton)[\s>]/g;

    /**
     * Does `expression` name an in-flight signal, directly or through ONE hop of
     * same-file resolution? Guards are routinely held in a local — `isLoading={busy}`
     * over `const busy = fetcher.state !== "idle"` is a real guard, and demanding
     * the signal inline would flag a dozen correct call sites. Resolving the
     * binding is what lets the check accept those while still rejecting
     * `isDisabled={loading}` over `const [loading] = useState(true)`, whose
     * declaration names no submit state.
     *
     * One hop, never recursive: a chain long enough to matter is beyond what a
     * text scan should claim to understand, and the baseline is the escape hatch.
     */
    const namesInFlightSignal = (
      expression: string,
      contents: string
    ): boolean => {
      if (inFlightSignal.test(expression)) return true;
      for (const identifier of expression.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        const declaration = new RegExp(
          `\\b(?:const|let|var)\\s+${identifier}\\s*=([^;\n]*(?:\n(?!\\s*(?:const|let|var|function|return)\\b)[^;\n]*)*)`
        ).exec(contents);
        if (declaration && inFlightSignal.test(declaration[1] ?? "")) {
          return true;
        }
      }
      return false;
    };

    /**
     * Does the tag disable itself while its own submission runs? The signal has to
     * sit on a prop that actually disables — finding `isSubmitting` anywhere in the
     * tag would accept `title={isSubmitting ? "Saving" : "Save"}`, which changes a
     * tooltip and nothing else.
     */
    const isGuarded = (tag: string, contents: string): boolean => {
      if (bareLoadingProp.test(tag)) return true;
      return disablingProps.some((prop) => {
        const expression = propExpression(tag, prop);
        return expression !== null && namesInFlightSignal(expression, contents);
      });
    };

    /**
     * Is `index` inside a `<ValidatedForm>`? ValidatedForm drops a re-entrant
     * submit in `handleSubmit`, so a second click cannot produce a second POST
     * however the button is written — flagging those would be noise.
     *
     * Matches the complete tag name: a prefix match would let a hypothetical
     * `<ValidatedFormProvider>` exempt a button it establishes no guard for.
     */
    const validatedFormOpen = /<ValidatedForm(?![A-Za-z0-9_])/g;

    const inValidatedForm = (contents: string, index: number): boolean => {
      validatedFormOpen.lastIndex = 0;
      let open = -1;
      let match: RegExpExecArray | null = validatedFormOpen.exec(contents);
      while (match !== null && match.index < index) {
        open = match.index;
        match = validatedFormOpen.exec(contents);
      }
      if (open === -1) return false;
      const close = contents.indexOf("</ValidatedForm>", open);
      return close === -1 || close > index;
    };

    return (file, contents) => {
      if (!file.endsWith(".tsx")) return [];
      if (excludedFiles.has(file)) return [];

      const violations: Violation[] = [];
      openTag.lastIndex = 0;
      let match: RegExpExecArray | null = openTag.exec(contents);
      while (match !== null) {
        const start = match.index;
        const tag = openingTag(contents, start);
        if (
          tag &&
          submitAttr.test(tag) &&
          !isGuarded(tag, contents) &&
          !inValidatedForm(contents, start)
        ) {
          violations.push({
            file,
            line: lineOf(contents, start),
            // One line, so the baseline key stays stable when the tag is
            // reformatted across lines.
            snippet: tag.replace(/\s+/g, " ").trim(),
            message:
              "Submit button stays live while the submission is in flight — every extra click is another POST the server runs to completion. Bind isDisabled/isLoading to the fetcher's state, or use <Submit> inside a ValidatedForm"
          });
        }
        openTag.lastIndex = start + 1;
        match = openTag.exec(contents);
      }
      return violations;
    };
  }
});
