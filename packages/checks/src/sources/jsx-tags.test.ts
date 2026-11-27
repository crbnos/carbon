// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { openingTag, propExpression } from "./jsx-tags";

describe("openingTag", () => {
  it("reads past a > in an expression, a string and a nested tag", () => {
    const contents = `x <Modal a={b > c} t="> " n={<b>Don't</b>} /> rest`;
    expect(openingTag(contents, contents.indexOf("<Modal"))).toBe(
      `<Modal a={b > c} t="> " n={<b>Don't</b>} />`
    );
  });

  it("is null on an unterminated tag", () => {
    expect(openingTag("<Modal a={b", 0)).toBeNull();
  });
});

describe("propExpression", () => {
  it("reads the prop's braced expression whole, and not a prefixed prop", () => {
    expect(propExpression("<X open={a({ b })} />", "open")).toBe("a({ b })");
    expect(propExpression("<X data-open={a} />", "open")).toBeNull();
  });
});
