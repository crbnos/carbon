// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type Check,
  defineCheck,
  type SourceFile,
  type Violation
} from "../check";
import { maskCommentsAndStrings } from "../sources/comments";
import { readIfPresent } from "../sources/cross-file";
import { requestHandlingTypescript, typescript } from "../sources/inputs";
import { loadModules, modulesDir } from "../sources/modules";
import { lineOf } from "../sources/text";

// Checks on the apps' React UI: how a dialog opens and closes, how a form
// submits and how many fields it shows, zod defaults, translation macros,
// revalidation, drag sensors, and the columns a list table exports. All but the
// last read one file at a time; `list-select-covers-columns` compares each list
// table with the columns its service selects.

// Modal and Drawer hide their close button when they are held open with no
// `onOpenChange`. A handler that does nothing defeats that: the dialog still
// cannot be closed, and the X is back, clickable and dead.
const NOOP_HANDLER =
  /onOpenChange=\{\s*(?:\(\w*\)\s*=>\s*(?:\{\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)?\s*\}|undefined|null|void 0)|noop)\s*\}/g;

export const noNoopOpenChange = defineCheck({
  files: typescript,
  id: "no-noop-open-change",
  triggers: ["onOpenChange="],
  description:
    "A dialog that cannot be dismissed omits onOpenChange instead of passing a handler that does nothing",
  provenance: {
    deprecates: "onOpenChange={() => {}} on a Modal or Drawer",
    replacedBy:
      "leaving onOpenChange off, which also removes the close button (@carbon/react)",
    since: "2026-10-04"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const match of contents.matchAll(NOOP_HANDLER)) {
      violations.push({
        file,
        line: lineOf(contents, match.index),
        snippet: match[0].replace(/\s+/g, " "),
        message:
          "Remove onOpenChange: a dialog with no handler cannot be dismissed and shows no close button"
      });
    }
    return violations;
  }
});

// A Radix dialog plays its closing animation only while it stays on the page
// and its `open` prop turns false. Two patterns removed it in the same render
// instead, so every modal and drawer animated in and vanished on close:
//
//   - `{disclosure.isOpen && <ConfirmDelete … />}` (or a ternary): closing clears the flag,
//     and the dialog leaves with it. Pass the flag as `isOpen`/`open` instead.
//   - a route rendered as a dialog and closed with `useCloseRoute()`: the
//     navigation removes the route. `useRouteDialog()` closes the dialog
//     first and navigates when it is off the page.
//
// A conditional dialog fails when the condition removes it in the render it
// closes in:
//   - its tag passes no real `open`/`isOpen` (a bare `open` or `open={true}`
//     does not count);
//   - the condition is its own open state, under any name
//     (`sel && <D isOpen={!!sel} />`);
//   - its own close handler clears the record the condition guards on.
// It also fails `if (!isOpen) return null` in a file that renders a dialog
// primitive, and any `useCloseRoute(` call. `packages/react/src/hooks/` is
// skipped: `useCloseRoute` and `useRouteDialog` are defined there.
//
// The fix: pass the `open` prop, and keep per-open state in a body inside the
// content (`.claude/rules/conventions-ui.md`, Modals and Drawers).
//
// The check reads text only. It does not see a dialog named otherwise, a
// `*Form` whose modal mode is not a literal `type="modal"`, or a route closed
// with `navigate(...)`.
//
// The baselined sites were each reviewed: trigger components that hold their
// own open state (the Linear and Jira issue dialogs, `ActionTaskAddModal`,
// `WorkflowLockModal`), full pages that call `useCloseRoute`, a polling modal
// (`JobProgressModal`) and a dead modal (`MaintenanceDispatchProperties`).

// A component that renders a dialog: the primitives, the `Confirm*` /
// `Delete*` confirms, and the `*Modal` / `*Drawer` / `*Dialog` components
// built on them. A `*Form` with `type="modal"` is a dialog too (see `scan`).
const DIALOG_NAME =
  /^(?:Modal|ModalCard|Drawer|ModalDrawer|Confirm\w*|Delete\w*|[A-Z]\w*(?:Modal|Drawer|Dialog))$/;

// `cond && <D />`, `cond || <D />`, `cond ? <D /> : …`, `cond ? null : <D />`
// and the else branch after JSX, `cond ? <Spinner /> : <D />`.
const CONDITIONAL_TAG =
  /(?:&&|\|\||\?(?:\s*(?:null|undefined|false)\s*:)?|(?<=[)>]\s*):)\s*\(?\s*<([A-Z][\w.]*)(?=[\s/>])/g;

const CLOSE_ROUTE = /\buseCloseRoute\s*\(/g;

const EARLY_RETURN = /\bif\s*\(\s*!(?:isOpen|open)\s*\)\s*return\s+null\b/g;
const RENDERS_DIALOG = /<(?:Modal|Drawer|ModalDrawer|ModalCard)[\s>]/;

const EXCLUDED_PREFIX = "packages/react/src/hooks/";

/**
 * Text of the JSX opening tag at `start`, aware of braces, strings, comments
 * and JSX nested in its props, so a `>` in `{a > b}`, in a string or in a
 * nested tag does not end it. Null on an unterminated tag.
 */
function openingTag(contents: string, start: number): string | null {
  // Where each character sits: a tag's attributes, a `{…}` expression, or the
  // children of JSX nested in one, where a quote is text ("Don't").
  const stack: Array<"tag" | "expression" | "text"> = ["tag"];
  let quote: string | null = null;
  for (let i = start; i < contents.length; i++) {
    const c = contents[i];
    const context = stack[stack.length - 1];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (context === "text") {
      if (c === "{") stack.push("expression");
      else if (c === "<" && contents[i + 1] === "/") {
        const end = contents.indexOf(">", i);
        if (end === -1) return null;
        i = end;
        stack.pop();
      } else if (c === "<") stack.push("tag");
      continue;
    }
    if (context === "expression") {
      // A comment may hold an apostrophe ("method's").
      if (c === "/" && contents[i + 1] === "*") {
        const end = contents.indexOf("*/", i + 2);
        if (end === -1) return null;
        i = end + 1;
        continue;
      }
      if (c === "/" && contents[i + 1] === "/") {
        const end = contents.indexOf("\n", i);
        if (end === -1) return null;
        i = end;
        continue;
      }
      // JSX, not `a < b` or `Array<T>`.
      if (
        c === "<" &&
        /[A-Za-z>]/.test(contents[i + 1] ?? "") &&
        !/[\w$)\]]$/.test(contents.slice(start, i).trimEnd())
      ) {
        stack.push("tag");
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") stack.push("expression");
    else if (c === "}" && context === "expression") stack.pop();
    else if (c === ">" && context === "tag") {
      if (stack.length === 1) return contents.slice(start, i + 1);
      stack.pop();
      if (contents[i - 1] !== "/") stack.push("text");
    }
  }
  return null;
}

/**
 * The `{...}` expression bound to `prop` in a JSX opening tag, brace-balanced.
 * The prop itself, not `data-open` or `aria-disabled`.
 */
function propExpression(tag: string, prop: string): string | null {
  const at = new RegExp(`(?<![\\w-])${prop}\\s*=\\s*\\{`).exec(tag);
  if (!at) return null;
  const start = at.index + at[0].length;
  let depth = 1;
  for (let i = start; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(start, i);
  }
  return null;
}

/**
 * The open state the tag passes, or null. A bare `open` or `open={true}` is
 * held open, so the condition around the tag still decides when it leaves.
 */
function openExpression(tag: string): string | null {
  const expression = (
    propExpression(tag, "open") ?? propExpression(tag, "isOpen")
  )?.trim();
  return expression && expression !== "true" ? expression : null;
}

/**
 * The condition in front of `&&` or `?`: the text back to the `{` that opens
 * the JSX expression, or to the start of the expression it sits in (`(`, `;`,
 * `=`, `=>`, `return`, an earlier ternary's `?` or `:`) when it is not in JSX.
 */
function conditionBefore(contents: string, index: number): string {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = contents[i];
    if (c === "}" || c === ")" || c === "]") depth++;
    else if (c === "{" || c === "(" || c === "[") {
      if (depth === 0) return contents.slice(i + 1, index);
      depth--;
    } else if (depth === 0) {
      // `;`, or the `:` / `?` of an earlier ternary (not `?.`).
      if (c === ";" || c === ":" || (c === "?" && contents[i + 1] !== ".")) {
        return contents.slice(i + 1, index);
      }
      // `=` that assigns, or the `>` of `=>`; not `==`, `!=`, `<=`, `>=`.
      if (c === ">" && contents[i - 1] === "=") {
        return contents.slice(i + 1, index);
      }
      if (c === "=" && !"=!<>".includes(contents[i - 1] ?? "")) {
        if (contents[i + 1] !== "=") return contents.slice(i + 1, index);
      }
      if (/\breturn\s*$/.test(contents.slice(Math.max(0, i - 6), i + 1))) {
        return contents.slice(i + 1, index);
      }
    }
  }
  return "";
}

// A condition on the open state itself (`x.isOpen`, `isOpen`, `open`) still
// removes the dialog when it closes, whatever the tag passes as `open`.
const OPEN_STATE_CONDITION = /(?:\.|\b)(?:isOpen|open)\b(?!\s*(?:\(|=(?!=)))/;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function conditionIsOpenState(condition: string, expression: string): boolean {
  if (OPEN_STATE_CONDITION.test(condition)) return true;
  // `{showDelete && <ConfirmDelete isOpen={showDelete} />}`, and the same
  // value turned to a boolean: `isOpen={!!selected}`, `Boolean(selected)`.
  const value = expression
    .replace(/^!!\s*/, "")
    .replace(/^Boolean\((.*)\)$/, "$1")
    .trim();
  if (!/^[\w$.?!]+$/.test(value)) {
    return condition.replace(/\s+/g, "") === value.replace(/\s+/g, "");
  }
  return new RegExp(
    `(?<![\\w$.])${escapeRegExp(value)}(?![\\w$])(?!\\s*(?:\\(|=(?!=)))`
  ).test(condition);
}

/**
 * Does the dialog's own close clear the record its condition guards on?
 * `{selected && <ConfirmDelete isOpen={d.isOpen} onCancel={() => { d.onClose();
 * setSelected(null); }} />}` removes the dialog in the render it closes in. A
 * handler passed by name (`onCancel={onDeleteCancel}`) is read from its
 * declaration in the same file.
 */
function clearsGuardOnClose(
  condition: string,
  tag: string,
  contents: string
): boolean {
  const handlers = [tag];
  for (const [, name] of tag.matchAll(
    /\bon(?:Cancel|Close|Submit|OpenChange)\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g
  )) {
    const declaration = new RegExp(
      `(?:const|let|function)\\s+${name}\\b[^\\n]*(?:\\n(?!\\s*(?:const|let|function|return)\\b)[^\\n]*){0,12}`
    ).exec(contents);
    if (declaration) handlers.push(declaration[0]);
  }
  for (const [, name] of condition.matchAll(/(?<![\w$.])([a-z]\w*)\b/g)) {
    if (!name) continue;
    const setter = `set${name[0]?.toUpperCase()}${name.slice(1)}`;
    const clears = new RegExp(
      `\\b${setter}\\(\\s*(?:null|undefined|false)\\s*\\)`
    );
    if (handlers.some((text) => clears.test(text))) return true;
  }
  return false;
}

export const noUnmountingDialog = defineCheck({
  files: typescript,
  id: "no-unmounting-dialog",
  triggers: [
    "Modal",
    "Drawer",
    "Dialog",
    "Confirm",
    "Delete",
    'type="modal"',
    "useCloseRoute"
  ],
  description:
    "A modal or drawer stays mounted and closes through its open prop, so its closing animation plays",
  provenance: {
    deprecates:
      "`{x.isOpen && <Dialog />}` and route dialogs closed with useCloseRoute()",
    replacedBy:
      "`<Dialog open={x.isOpen} />`, and useRouteDialog() for a route dialog (@carbon/react)",
    since: "2026-11-06"
  },
  scan(file: string, contents: string): Violation[] {
    if (!file.endsWith(".tsx") || file.startsWith(EXCLUDED_PREFIX)) return [];
    const violations: Violation[] = [];

    for (const match of contents.matchAll(CONDITIONAL_TAG)) {
      const name = match[1] ?? "";
      const start = (match.index ?? 0) + match[0].lastIndexOf("<");
      const tag = openingTag(contents, start);
      if (tag === null) continue;
      const isModalForm = /Form$/.test(name) && /\btype="modal"/.test(tag);
      if (!DIALOG_NAME.test(name) && !isModalForm) continue;
      const expression = openExpression(tag);
      const condition = conditionBefore(contents, match.index ?? 0);
      if (
        expression &&
        !conditionIsOpenState(condition, expression) &&
        !clearsGuardOnClose(condition, tag, contents)
      ) {
        continue;
      }
      violations.push({
        file,
        line: lineOf(contents, start),
        snippet: tag.replace(/\s+/g, " ").slice(0, 160),
        message: `Render <${name}> always and pass the condition as its open prop: removed in the same render, it cannot animate closed`
      });
    }

    if (RENDERS_DIALOG.test(contents)) {
      for (const match of contents.matchAll(EARLY_RETURN)) {
        violations.push({
          file,
          line: lineOf(contents, match.index ?? 0),
          snippet: match[0],
          message:
            "Pass isOpen to the dialog instead of returning null: removed in the same render, it cannot animate closed"
        });
      }
    }

    for (const match of contents.matchAll(CLOSE_ROUTE)) {
      violations.push({
        file,
        line: lineOf(contents, match.index ?? 0),
        snippet: "useCloseRoute(",
        message:
          "Close a route dialog with useRouteDialog(): it closes the dialog first, then leaves the route"
      });
    }

    return violations;
  }
});

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
//     so buttons under one are not flagged at all (see IN_VALIDATED_FORM).
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

// An in-flight SIGNAL, not merely the presence of `isDisabled`. The quote bug
// was `isDisabled={loading}`, where `loading` was the modal's data-fetch flag —
// a check that accepted any `isDisabled` would have passed the exact line it
// exists to catch. Word boundaries are load-bearing: `loading` must not satisfy
// `isLoading`.
const IN_FLIGHT_SIGNAL =
  /\bisLoading\b|\bisSubmitting\b|\bisPending\b|\bisSaving\b|\buseIsSubmitting\b|\b\w*(?:fetcher|navigation|transition)\w*\.(?:state|formAction)\b/i;

// Props that actually disable the button. All three are checked the same way —
// the bound expression must name an in-flight signal. Presence alone is not
// enough: `isLoading={false}` spins nothing and disables nothing, and
// `isDisabled={loading}` bound to a data-fetch flag is the exact bug this
// check exists to catch.
const DISABLING_PROPS = ["disabled", "isDisabled", "isLoading"];

// A bare `isLoading` with no expression is `true` — permanently disabled, so
// a second submit is impossible.
const BARE_LOADING_PROP = /\bisLoading\s*(?:\/?>|\s+[a-zA-Z-]+\s*=|\s*$)/;

// Match `type` at an attribute boundary, both JSX quote styles. Searching for
// the bare text matched `data-type="submit"` on a non-submit button and missed
// `type='submit'`.
const SUBMIT_ATTR = /(?:^|[\s{])type\s*=\s*["']submit["']/;

// Where the two guards are DEFINED. `<Submit>` renders `type="submit"` and is
// the component this check tells everyone else to use.
const EXCLUDED_FILES = new Set(["packages/form/src/components/Submit.tsx"]);

const OPEN_TAG = /<(Button|button|IconButton)[\s>]/g;

/**
 * Does the tag disable itself while its own submission runs? The signal has to
 * sit on a prop that actually disables — finding `isSubmitting` anywhere in the
 * tag would accept `title={isSubmitting ? "Saving" : "Save"}`, which changes a
 * tooltip and nothing else.
 */
function isGuarded(tag: string, contents: string): boolean {
  if (BARE_LOADING_PROP.test(tag)) return true;
  return DISABLING_PROPS.some((prop) => {
    const expression = propExpression(tag, prop);
    return expression !== null && namesInFlightSignal(expression, contents);
  });
}

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
function namesInFlightSignal(expression: string, contents: string): boolean {
  if (IN_FLIGHT_SIGNAL.test(expression)) return true;
  for (const identifier of expression.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    const declaration = new RegExp(
      `\\b(?:const|let|var)\\s+${identifier}\\s*=([^;\n]*(?:\n(?!\\s*(?:const|let|var|function|return)\\b)[^;\n]*)*)`
    ).exec(contents);
    if (declaration && IN_FLIGHT_SIGNAL.test(declaration[1] ?? "")) return true;
  }
  return false;
}

/**
 * Is `index` inside a `<ValidatedForm>`? ValidatedForm drops a re-entrant
 * submit in `handleSubmit`, so a second click cannot produce a second POST
 * however the button is written — flagging those would be noise.
 *
 * Matches the complete tag name: a prefix match would let a hypothetical
 * `<ValidatedFormProvider>` exempt a button it establishes no guard for.
 */
const VALIDATED_FORM_OPEN = /<ValidatedForm(?![A-Za-z0-9_])/g;

function inValidatedForm(contents: string, index: number): boolean {
  VALIDATED_FORM_OPEN.lastIndex = 0;
  let open = -1;
  let match: RegExpExecArray | null = VALIDATED_FORM_OPEN.exec(contents);
  while (match !== null && match.index < index) {
    open = match.index;
    match = VALIDATED_FORM_OPEN.exec(contents);
  }
  if (open === -1) return false;
  const close = contents.indexOf("</ValidatedForm>", open);
  return close === -1 || close > index;
}

export const noUnguardedSubmit = defineCheck({
  files: typescript,
  id: "no-unguarded-submit",
  triggers: ['"submit"', "'submit'"],
  description:
    'A submit button must disable while its submission is in flight — use <Submit> inside a ValidatedForm, or isDisabled={fetcher.state !== "idle"} with isLoading',
  provenance: {
    deprecates:
      'raw <Button type="submit"> with no in-flight guard, which posts again on every click',
    replacedBy:
      "<Submit> from @carbon/form, or isDisabled/isLoading bound to the fetcher's state",
    since: "2026-09-30"
  },
  scan(file: string, contents: string): Violation[] {
    if (!file.endsWith(".tsx")) return [];
    if (EXCLUDED_FILES.has(file)) return [];

    const violations: Violation[] = [];
    OPEN_TAG.lastIndex = 0;
    let match: RegExpExecArray | null = OPEN_TAG.exec(contents);
    while (match !== null) {
      const start = match.index;
      const tag = openingTag(contents, start);
      if (
        tag &&
        SUBMIT_ATTR.test(tag) &&
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
      OPEN_TAG.lastIndex = start + 1;
      match = OPEN_TAG.exec(contents);
    }
    return violations;
  }
});

// A form that asks for everything on one screen overloads the user: the
// project contract's Add Line had 17 fields in one three-column grid, with
// holes where hidden fields had been (Brad, 2026-10-23). The carbon-design
// forms guide (`references/forms.md` §4a) sets the budget: flat up to ~8
// fields, titled groups to ~14, steps beyond. This check counts the named
// fields a form file renders and flags one over the budget that has no
// groups, folds or steps. It reads the file, not the screen: fields behind a
// condition count too, so it nudges rather than measures.
const APP_UI = /^apps\/(?:erp|mes)\/app\/.*\.tsx$/;
const FORM = /<ValidatedForm\b/;
// A field is a JSX element with a literal `name` prop; `Hidden` posts a value
// the user never sees.
const FIELD = /<([A-Z][A-Za-z0-9.]*)\b[^<>]*?\bname="[^"]+"/g;
// The grouping pieces of `~/components/Form` (FormLayout), the setup
// wizard's sections and the older heavy subheading.
const GROUPED =
  /<(?:FormGroup|FormFold|FormStepPanel|FormSection|SetupSection)\b|<Subheading[^>]*variant="heavy"/;

export const FORM_FIELD_BUDGET = 14;

export const formFieldBudget = defineCheck({
  files: typescript,
  id: "form-field-budget",
  triggers: ["<ValidatedForm"],
  description: `a form with more than ${FORM_FIELD_BUDGET} fields groups them (FormGroup / FormFold) or steps them (FormStep*)`,
  provenance: {
    deprecates: "a long flat form grid",
    replacedBy: "FormGroup, FormFold and FormStep* from ~/components/Form",
    since: "2026-10-23"
  },
  scan(file: string, contents: string): Violation[] {
    if (!APP_UI.test(file)) return [];
    // A Properties panel is a column of autosaving fields, one form each,
    // not one long form.
    if (/Properties(?:\.ee)?\.tsx$/.test(file)) return [];
    const form = FORM.exec(contents);
    if (!form) return [];
    if (GROUPED.test(contents)) return [];
    let fields = 0;
    for (const match of contents.matchAll(FIELD)) {
      if (match[1] !== "Hidden") fields += 1;
    }
    if (fields <= FORM_FIELD_BUDGET) return [];
    return [
      {
        file,
        line: lineOf(contents, form.index),
        // One key per file: an old form stays baselined as it changes.
        snippet: "<ValidatedForm>",
        message: `This form renders ${fields} fields in one grid (budget ${FORM_FIELD_BUDGET}). Group them with FormGroup / FormFold, or step them with FormStepBar / FormStepPanel / FormStepButtons (carbon-design forms.md §4a)`
      }
    ];
  }
});

// zod v4 changed `.default()` semantics: on `undefined` input the default value
// is returned AS-IS — it is no longer parsed through the schema. On a chain that
// carries a transform/refinement/pipe, the default therefore bypasses the effect
// entirely: `z.string().min(3).transform(fn).default("ab")` silently emits "ab"
// untransformed and unvalidated (v3 would have re-parsed it). Typecheck cannot
// catch this — the literal satisfies the OUTPUT type either way. Use
// `.prefault()` when the default must be parsed, or verify the literal is a
// valid output and baseline the site.
const EFFECTS =
  /\.(transform|refine|superRefine|check|overwrite|pipe)\s*\(|\bz\.preprocess\s*\(/;

const DEFAULT_CALL = /\.default\s*\(/g;

// Walk backwards from the `.` of `.default(` over the receiver expression:
// balanced (...)/[...]/{...} groups plus identifier chars, dots, and
// whitespace. Stops at anything else (an operator, `=`, the enclosing call's
// open paren), which bounds the receiver to the chain `.default` is called on.
function receiverBefore(text: string, dotIndex: number): string {
  let i = dotIndex - 1;
  while (i >= 0) {
    const c = text[i];
    if (c === undefined) break;
    // A bare `}` here is a block/statement boundary, not part of a schema
    // chain (an object literal in a chain sits inside an already-skipped call
    // group) — skipping it would leak a previous block into the receiver.
    if (c === "}") break;
    if (c === ")" || c === "]") {
      let depth = 1;
      i--;
      while (i >= 0 && depth > 0) {
        const ch = text[i];
        if (ch === ")" || ch === "]" || ch === "}") depth++;
        else if (ch === "(" || ch === "[" || ch === "{") depth--;
        i--;
      }
      continue;
    }
    if (/[\w$.\s]/.test(c)) {
      i--;
      continue;
    }
    break;
  }
  return text.slice(i + 1, dotIndex);
}

export const noDefaultOnEffects = defineCheck({
  files: typescript,
  id: "no-default-on-effects",
  triggers: [".default"],
  description:
    "`.default()` on a schema with transforms/refinements/pipes is not re-parsed in zod v4 — use `.prefault()` when the default must run through the schema",
  provenance: {
    deprecates:
      "zod v3 `.default()` on effect-bearing schemas (the default was re-parsed through the schema)",
    replacedBy:
      "`.prefault()` when the default must be parsed; a verified output-typed literal otherwise",
    since: "2026-09-05"
  },
  scan(file: string, contents: string): Violation[] {
    // Masking only blanks characters, so a `.default` it leaves was in the file.
    if (!contents.includes(".default")) return [];
    const violations: Violation[] = [];
    // Scan the masked source so comments and string literals can neither fake
    // a violation nor hide one; report from the ORIGINAL so the snippet the
    // developer sees is the real line.
    const masked = maskCommentsAndStrings(contents);
    for (const match of masked.matchAll(DEFAULT_CALL)) {
      const receiver = receiverBefore(masked, match.index);
      if (!EFFECTS.test(receiver)) continue;
      const line = lineOf(contents, match.index);
      const lineText = contents.split("\n")[line - 1] ?? "";
      violations.push({
        file,
        line,
        snippet: lineText.trim(),
        message:
          "`.default()` after a transform/refine/pipe is NOT re-parsed in zod v4 — the value bypasses the effect. Use `.prefault()` to parse it, or verify the literal is a valid OUTPUT and baseline this site."
      });
    }
    return violations;
  }
});

// React Router's `revalidate()` during an action drops the fetcher's redirect,
// and during the navigation that follows a save it restarts that navigation
// without the submission. `useRevalidator` from `@carbon/query` holds the call
// until the router is idle.
const ROUTER_IMPORT =
  /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']react-router["']/g;
// The wrapper itself: the one place that takes React Router's.
const DEFINITION = "packages/react/src/hooks/useRevalidator.ts";

export const noRawRevalidator = defineCheck({
  files: typescript,
  id: "no-raw-revalidator",
  triggers: ["useRevalidator"],
  description:
    "useRevalidator must come from @carbon/query, which holds a revalidation while a save is in flight",
  provenance: {
    deprecates: 'import { useRevalidator } from "react-router"',
    replacedBy: 'import { useRevalidator } from "@carbon/query"',
    since: "2026-10-06"
  },
  scan(file: string, contents: string): Violation[] {
    if (file === DEFINITION) return [];
    const violations: Violation[] = [];
    for (const match of contents.matchAll(ROUTER_IMPORT)) {
      if (!/\buseRevalidator\b/.test(match[1]!)) continue;
      const line = lineOf(contents, match.index);
      violations.push({
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message:
          "Import `useRevalidator` from \"@carbon/query\": React Router's can drop a save's redirect or restart the navigation that follows it"
      });
    }
    return violations;
  }
});

// No `runtimeConfigModule` is configured, so `t` from @lingui/core/macro
// compiles to a call on the global i18n instance, which is never activated:
// it throws "Attempted to call a translation function without setting a
// locale". `msg` from the same module is the right way to build a descriptor.
const CORE_T_IMPORT =
  /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']@lingui\/core\/macro["']/g;
// `i18n._(msg`Scrap`)` is the long way round to `t`Scrap``. Rendering a
// descriptor built elsewhere, `i18n._(descriptor)`, is fine and not matched.
const UNWRAPPED_MSG = /[._]\(\s*msg`|\bt\(\s*msg\(/g;

export const linguiMacroMisuse = defineCheck({
  files: requestHandlingTypescript,
  id: "lingui-macro-misuse",
  triggers: ["@lingui/core/macro", "msg`", "msg("],
  description:
    "Translate with useLingui().t / <Trans>; never the global t, never i18n._(msg`...`)",
  provenance: {
    deprecates: "t from @lingui/core/macro, i18n._(msg`...`)",
    replacedBy:
      "useLingui().t or <Trans> from @lingui/react/macro (.claude/rules/i18n-lingui-system.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    const at = (index = 0) => lineOf(contents, index);
    return [
      ...[...contents.matchAll(CORE_T_IMPORT)].map((m) => ({
        file,
        line: at(m.index),
        snippet: 'import { t } from "@lingui/core/macro"',
        message:
          "t from @lingui/core/macro calls the global i18n instance, which is never activated; use useLingui().t from @lingui/react/macro"
      })),
      ...[...contents.matchAll(UNWRAPPED_MSG)].map((m) => ({
        file,
        line: at(m.index),
        snippet: m[0],
        message: "Use t`...` instead of unwrapping a literal msg`...`"
      }))
    ];
  }
});

// dnd-kit's `useSensor(sensor, options)` memoizes on the options object. An
// inline literal is a new object on every render, so the sensor is new, and
// with it the listeners of every draggable under the context: a memoized card
// then re-renders on each render of its board. On the schedule board that was
// every card's full body each time the drop target changed, and a drag
// stuttered (frames over 100 ms with 82 cards).
const INLINE_OPTIONS = /^useSensor\(\s*\w+\s*,\s*\{/;

export const noInlineSensorOptions = defineCheck({
  files: typescript,
  id: "no-inline-sensor-options",
  triggers: ["useSensor("],
  description:
    "useSensor options must be a module constant, not an object literal created on every render",
  provenance: {
    deprecates: "useSensor(KeyboardSensor, { coordinateGetter })",
    replacedBy:
      "a module-level constant: useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)",
    since: "2026-10-06"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    const lines = contents.split("\n");
    lines.forEach((text, index) => {
      const at = text.search(/\buseSensor\(/);
      if (at < 0) return;
      // From the call onward, with the next lines: the options may start on
      // one of them.
      const call = `${text.slice(at)}\n${lines[index + 1] ?? ""}\n${lines[index + 2] ?? ""}`;
      if (!INLINE_OPTIONS.test(call)) return;
      violations.push({
        file,
        line: index + 1,
        snippet: text.trim(),
        message:
          "Hoist the options to a module constant: an inline object makes a new sensor, and new listeners for every draggable, on every render"
      });
    });
    return violations;
  }
});

const UI = "apps/erp/app/modules";

/**
 * The view-backed list endpoints select an explicit column list (so Postgres
 * prunes the views' unused computed columns), and each list table exports the
 * columns it declares. The narrowed select narrows the row type, but the CSV
 * export (`Table/components/Download.tsx`) reads `row[accessorKey]` untyped:
 * an accessorKey the select dropped exports blank, and nothing else fails.
 *
 * Each `*_LIST_COLUMNS` constant names the table that renders its rows.
 * Not covered: `meta.exportValue` / `exportOnlyColumn` read arbitrary fields.
 *
 * Every constant must also select the columns its cursor reads: `toPage`
 * reads each sort column of the list's `X_PAGING` and its id from the last
 * row of a page, so a column missing from the select ends the list after
 * page 1.
 */
export const LIST_TABLES: Record<string, string> = {
  PARTS_LIST_COLUMNS: `${UI}/items/ui/Parts/PartsTable.tsx`,
  MATERIALS_LIST_COLUMNS: `${UI}/items/ui/Materials/MaterialsTable.tsx`,
  TOOLS_LIST_COLUMNS: `${UI}/items/ui/Tools/ToolsTable.tsx`,
  CONSUMABLES_LIST_COLUMNS: `${UI}/items/ui/Consumables/ConsumablesTable.tsx`,
  SERVICES_LIST_COLUMNS: `${UI}/items/ui/Services/ServicesTable.tsx`,
  PURCHASE_ORDERS_LIST_COLUMNS: `${UI}/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx`,
  QUOTES_LIST_COLUMNS: `${UI}/sales/ui/Quotes/QuotesTable.tsx`,
  SALES_ORDERS_LIST_COLUMNS: `${UI}/sales/ui/SalesOrder/SalesOrdersTable.tsx`,
  PURCHASE_INVOICES_LIST_COLUMNS: `${UI}/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx`,
  SALES_INVOICES_LIST_COLUMNS: `${UI}/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx`,
  CUSTOMERS_LIST_COLUMNS: `${UI}/sales/ui/Customers/CustomersTable.tsx`,
  SUPPLIERS_LIST_COLUMNS: `${UI}/purchasing/ui/Supplier/SuppliersTable.tsx`,
  CONTRACTS_LIST_COLUMNS: `${UI}/sales/ui/Contracts/ContractsTable.tsx`
};

/** Every module's `<m>.service.ts`, and the list tables `LIST_TABLES` names. */
export function loadListSources(root: string) {
  return {
    services: readIfPresent(
      root,
      loadModules(modulesDir(root)).map(
        ({ name }) => `apps/erp/app/modules/${name}/${name}.service.ts`
      )
    ),
    tables: readIfPresent(root, Object.values(LIST_TABLES))
  };
}

const LIST_CONSTANT = /const ([A-Z_]+_LIST_COLUMNS) =\s*"([^"]*)"/g;

/** The list-order columns of an `X_PAGING` constant (embedded-table sorts
 *  excluded) and its id column, or null when the service has no such constant. */
function pagingColumns(contents: string, paging: string): string[] | null {
  const match = contents.match(
    new RegExp(`export const ${paging}: Paging = \\{([\\s\\S]*?)\\};`)
  );
  if (!match) return null;
  const body = match[1] ?? "";
  const sorts = [...body.matchAll(/\{([^{}]*)\}/g)]
    .map((m) => m[1] ?? "")
    .filter((sort) => !sort.includes("foreignTable"))
    .map((sort) => sort.match(/column:\s*"([^"]+)"/)?.[1])
    .filter((column): column is string => Boolean(column));
  const idColumn = body.match(/idColumn:\s*"([^"]+)"/)?.[1] ?? "id";
  return [...sorts, idColumn];
}

/** Every list table's accessorKeys against the columns its endpoint selects. */
export function findUnselectedListColumns(
  services: SourceFile[],
  tables: SourceFile[]
): Violation[] {
  const out: Violation[] = [];
  const tableByFile = new Map(tables.map((t) => [t.file, t]));
  const found = new Set<string>();

  for (const service of services) {
    for (const match of service.contents.matchAll(LIST_CONSTANT)) {
      const [, constant = "", list = ""] = match;
      found.add(constant);
      const selected = new Set(list.split(","));
      const paging = `${constant.replace(/_LIST_COLUMNS$/, "")}_PAGING`;
      const cursorColumns = pagingColumns(service.contents, paging);
      if (!cursorColumns) {
        out.push({
          file: service.file,
          line: lineOf(service.contents, match.index),
          snippet: `${constant} has no ${paging}`,
          message: `${paging} not found beside ${constant}, so its cursor columns cannot be checked`
        });
      }
      for (const column of cursorColumns ?? []) {
        if (selected.has(column)) continue;
        out.push({
          file: service.file,
          line: lineOf(service.contents, match.index),
          snippet: `${constant} lacks cursor column ${column}`,
          message: `${paging} sorts or pages on "${column}" but ${constant} does not select it, so the list ends after page 1`
        });
      }
      // Checked for its cursor columns only: its table reads embedded records
      // (`location.name`), not flat accessors.
      if (constant === "FIXED_ASSETS_LIST_COLUMNS") continue;
      const tablePath = LIST_TABLES[constant];
      const table = tablePath ? tableByFile.get(tablePath) : undefined;
      if (!table) {
        out.push({
          file: service.file,
          line: lineOf(service.contents, match.index),
          snippet: constant,
          message: tablePath
            ? `${tablePath} not found; update LIST_TABLES in ui.ts`
            : `Add ${constant} and the table that renders it to LIST_TABLES in ui.ts`
        });
        continue;
      }
      for (const key of table.contents.matchAll(/accessorKey:\s*"([^"]+)"/g)) {
        const column = key[1] ?? "";
        // Custom-field columns are keyed `customFields->>{id}`; the
        // `customFields` column itself is what has to be selected.
        if (column.startsWith("customFields->>") || selected.has(column))
          continue;
        out.push({
          file: table.file,
          line: lineOf(table.contents, key.index),
          snippet: `${constant} lacks ${column}`,
          message: `accessorKey "${column}" is not in ${constant}, so it exports blank in the CSV download`
        });
      }
      if (
        table.contents.includes("useCustomColumns") &&
        !selected.has("customFields")
      ) {
        out.push({
          file: table.file,
          line: lineOf(
            table.contents,
            table.contents.indexOf("useCustomColumns")
          ),
          snippet: `${constant} lacks customFields`,
          message: `The table renders custom columns but ${constant} does not select customFields`
        });
      }
    }
  }

  for (const constant of Object.keys(LIST_TABLES)) {
    if (found.has(constant)) continue;
    out.push({
      file: "packages/checks/src/conformance/ui.ts",
      line: 0,
      snippet: constant,
      message: `${constant} is not defined in any module service; update LIST_TABLES`
    });
  }
  return out;
}

export const listSelectCoversColumns = defineCheck({
  id: "list-select-covers-columns",
  triggers: ["_LIST_COLUMNS", "accessorKey"],
  description:
    "Every list table's accessorKeys, and the columns its cursor reads, are in the columns its endpoint selects.",
  reads: { sources: loadListSources },
  find: ({ sources }) =>
    findUnselectedListColumns(sources.services, sources.tables)
});

/** The ui checks, in the order they are written above. */
export const checks: Check[] = [
  noNoopOpenChange,
  noUnmountingDialog,
  noUnguardedSubmit,
  formFieldBudget,
  noDefaultOnEffects,
  noRawRevalidator,
  linguiMacroMisuse,
  noInlineSensorOptions,
  listSelectCoversColumns
];
