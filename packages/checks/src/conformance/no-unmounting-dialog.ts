// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// A Radix dialog plays its closing animation only while it stays on the page
// and its `open` prop turns false. Two patterns removed it in the same render
// instead, so every modal and drawer animated in and vanished on close:
//
//   - `{disclosure.isOpen && <ConfirmDelete … />}` (or a ternary): closing clears the flag,
//     and the dialog leaves with it. Pass the flag as `isOpen`/`open` instead.
//   - a route rendered as a dialog and closed with `useCloseRoute()`: the
//     navigation removes the route. `useRouteDialog()` closes the dialog
//     first and navigates when it is off the page.

// A component that renders a dialog: the primitives, the `Confirm*` /
// `Delete*` confirms, and the `*Modal` / `*Drawer` / `*Dialog` components
// built on them.
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

/** Text of the JSX opening tag at `start`, brace-, quote- and comment-aware. */
function openingTag(contents: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < contents.length; i++) {
    const c = contents[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    // A comment inside a `{…}` may hold an apostrophe ("method's").
    if (depth > 0 && c === "/" && contents[i + 1] === "*") {
      const end = contents.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    if (depth > 0 && c === "/" && contents[i + 1] === "/") {
      const end = contents.indexOf("\n", i);
      if (end === -1) return null;
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return contents.slice(start, i + 1);
  }
  return null;
}

/**
 * The open state the tag passes, or null. A bare `open` or `open={true}` is
 * held open, so the condition around the tag still decides when it leaves.
 */
function openExpression(tag: string): string | null {
  // The prop itself, not `data-open` or `aria-open`.
  const at = /(?<![\w-])(?:open|isOpen)\s*=\s*\{/.exec(tag);
  if (!at) return null;
  const start = at.index + at[0].length;
  let depth = 1;
  for (let i = start; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) {
      const expression = tag.slice(start, i).trim();
      return expression && expression !== "true" ? expression : null;
    }
  }
  return null;
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
  if (!/^[\w$.?!]+$/.test(value)) return false;
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

const lineOf = (contents: string, index: number) =>
  contents.slice(0, index).split("\n").length;

export const noUnmountingDialog: ConformanceCheck = {
  id: "no-unmounting-dialog",
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
};
