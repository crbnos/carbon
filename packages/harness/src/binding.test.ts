import { describe, expect, it } from "vitest";
import { parseBinding } from "./binding";

const MD = `---
id: bug-reorder
kind: bug
title: Reorder button misaligns
risk: low
acceptance:
- Button centers at <640px
- No console errors
---
Some freeform notes.`;

describe("parseBinding", () => {
  it("parses scalar fields and the acceptance list", () => {
    const b = parseBinding(MD);
    expect(b.id).toBe("bug-reorder");
    expect(b.kind).toBe("bug");
    expect(b.title).toBe("Reorder button misaligns");
    expect(b.risk).toBe("low");
    expect(b.acceptance).toEqual([
      "Button centers at <640px",
      "No console errors"
    ]);
  });

  it("throws on missing required fields", () => {
    expect(() => parseBinding("---\nkind: bug\n---")).toThrow(/id/);
  });

  it("parses an optional numeric issue, omits it when absent or non-numeric", () => {
    expect(parseBinding(`${MD}`).issue).toBeUndefined();
    expect(parseBinding("---\nid: x\nkind: bug\nissue: 450\n---").issue).toBe(
      450
    );
    expect(
      parseBinding("---\nid: x\nkind: bug\nissue: not-a-number\n---").issue
    ).toBeUndefined();
  });

  it("strips surrounding quotes from scalars and acceptance items", () => {
    const b = parseBinding(
      `---\nid: "q-1"\nkind: 'bug'\ntitle: "Fix: the thing"\nacceptance:\n- "centers at <640px"\n---`
    );
    expect(b.id).toBe("q-1");
    expect(b.kind).toBe("bug");
    expect(b.title).toBe("Fix: the thing");
    expect(b.acceptance).toEqual(["centers at <640px"]);
  });
});
