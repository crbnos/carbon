// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Text readers for a JSX opening tag, for the checks that read a component's
// props without parsing the file.

/**
 * Text of the JSX opening tag at `start`, aware of braces, strings, comments
 * and JSX nested in its props, so a `>` in `{a > b}`, in a string or in a
 * nested tag does not end it. Null on an unterminated tag.
 */
export function openingTag(contents: string, start: number): string | null {
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
export function propExpression(tag: string, prop: string): string | null {
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
