// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";
import { openingTag, propExpression } from "../../sources/jsx-tags";
import { lineOf } from "../../sources/text";

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
export const noUnmountingDialog = defineCheck({
  files: typescript,
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
  rule() {
    // A component that renders a dialog: the primitives, the `Confirm*` /
    // `Delete*` confirms, and the `*Modal` / `*Drawer` / `*Dialog` components
    // built on them. A `*Form` with `type="modal"` is a dialog too (see below).
    const dialogName =
      /^(?:Modal|ModalCard|Drawer|ModalDrawer|Confirm\w*|Delete\w*|[A-Z]\w*(?:Modal|Drawer|Dialog))$/;

    // `cond && <D />`, `cond || <D />`, `cond ? <D /> : …`, `cond ? null : <D />`
    // and the else branch after JSX, `cond ? <Spinner /> : <D />`.
    const conditionalTag =
      /(?:&&|\|\||\?(?:\s*(?:null|undefined|false)\s*:)?|(?<=[)>]\s*):)\s*\(?\s*<([A-Z][\w.]*)(?=[\s/>])/g;

    const closeRoute = /\buseCloseRoute\s*\(/g;

    const earlyReturn = /\bif\s*\(\s*!(?:isOpen|open)\s*\)\s*return\s+null\b/g;
    const rendersDialog = /<(?:Modal|Drawer|ModalDrawer|ModalCard)[\s>]/;

    const excludedPrefix = "packages/react/src/hooks/";

    /**
     * The open state the tag passes, or null. A bare `open` or `open={true}` is
     * held open, so the condition around the tag still decides when it leaves.
     */
    const openExpression = (tag: string): string | null => {
      const expression = (
        propExpression(tag, "open") ?? propExpression(tag, "isOpen")
      )?.trim();
      return expression && expression !== "true" ? expression : null;
    };

    /**
     * The condition in front of `&&` or `?`: the text back to the `{` that opens
     * the JSX expression, or to the start of the expression it sits in (`(`, `;`,
     * `=`, `=>`, `return`, an earlier ternary's `?` or `:`) when it is not in JSX.
     */
    const conditionBefore = (contents: string, index: number): string => {
      let depth = 0;
      for (let i = index - 1; i >= 0; i--) {
        const c = contents[i];
        if (c === "}" || c === ")" || c === "]") depth++;
        else if (c === "{" || c === "(" || c === "[") {
          if (depth === 0) return contents.slice(i + 1, index);
          depth--;
        } else if (depth === 0) {
          // `;`, or the `:` / `?` of an earlier ternary (not `?.`).
          if (
            c === ";" ||
            c === ":" ||
            (c === "?" && contents[i + 1] !== ".")
          ) {
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
    };

    // A condition on the open state itself (`x.isOpen`, `isOpen`, `open`) still
    // removes the dialog when it closes, whatever the tag passes as `open`.
    const openStateCondition = /(?:\.|\b)(?:isOpen|open)\b(?!\s*(?:\(|=(?!=)))/;

    const escapeRegExp = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const conditionIsOpenState = (
      condition: string,
      expression: string
    ): boolean => {
      if (openStateCondition.test(condition)) return true;
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
    };

    /**
     * Does the dialog's own close clear the record its condition guards on?
     * `{selected && <ConfirmDelete isOpen={d.isOpen} onCancel={() => { d.onClose();
     * setSelected(null); }} />}` removes the dialog in the render it closes in. A
     * handler passed by name (`onCancel={onDeleteCancel}`) is read from its
     * declaration in the same file.
     */
    const clearsGuardOnClose = (
      condition: string,
      tag: string,
      contents: string
    ): boolean => {
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
    };

    return (file, contents) => {
      if (!file.endsWith(".tsx") || file.startsWith(excludedPrefix)) return [];
      const violations: Violation[] = [];

      for (const match of contents.matchAll(conditionalTag)) {
        const name = match[1] ?? "";
        const start = (match.index ?? 0) + match[0].lastIndexOf("<");
        const tag = openingTag(contents, start);
        if (tag === null) continue;
        const isModalForm = /Form$/.test(name) && /\btype="modal"/.test(tag);
        if (!dialogName.test(name) && !isModalForm) continue;
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

      if (rendersDialog.test(contents)) {
        for (const match of contents.matchAll(earlyReturn)) {
          violations.push({
            file,
            line: lineOf(contents, match.index ?? 0),
            snippet: match[0],
            message:
              "Pass isOpen to the dialog instead of returning null: removed in the same render, it cannot animate closed"
          });
        }
      }

      for (const match of contents.matchAll(closeRoute)) {
        violations.push({
          file,
          line: lineOf(contents, match.index ?? 0),
          snippet: "useCloseRoute(",
          message:
            "Close a route dialog with useRouteDialog(): it closes the dialog first, then leaves the route"
        });
      }

      return violations;
    };
  }
});
