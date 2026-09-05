import type { ConformanceCheck, Violation } from "../check";

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

export const noDefaultOnEffects: ConformanceCheck = {
  id: "no-default-on-effects",
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
    const violations: Violation[] = [];
    for (const match of contents.matchAll(DEFAULT_CALL)) {
      const receiver = receiverBefore(contents, match.index);
      if (!EFFECTS.test(receiver)) continue;
      const line = contents.slice(0, match.index).split("\n").length;
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
};
