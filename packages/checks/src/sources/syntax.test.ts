// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { parseTypescript, walk } from "./syntax";

describe("walk", () => {
  const SOURCE = `// é it's
const el = open && <Dialog open={open} />;`;

  it("visits every node with its ancestors, offsets into the text", () => {
    const seen: string[] = [];
    walk(parseTypescript("a.tsx", SOURCE).program, (node, ancestors) => {
      if (node.type === "JSXAttribute") {
        seen.push(
          `${SOURCE.slice(node.start, node.end)} in ${ancestors.at(-1)?.type}`
        );
      }
    });
    expect(seen).toEqual(["open={open} in JSXOpeningElement"]);
  });

  it("skips the children of a node whose visit returns false", () => {
    const seen: string[] = [];
    walk(parseTypescript("a.tsx", SOURCE).program, (node) => {
      seen.push(node.type);
      return node.type !== "LogicalExpression";
    });
    expect(seen).not.toContain("JSXElement");
    expect(seen).toContain("LogicalExpression");
  });
});
