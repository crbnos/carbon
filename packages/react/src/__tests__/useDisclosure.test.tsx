// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import useDisclosure from "../hooks/useDisclosure";

let root: Root | undefined;
let disclosure: ReturnType<typeof useDisclosure>;

function Harness({ isOpen }: { isOpen?: boolean }) {
  disclosure = useDisclosure(isOpen === undefined ? {} : { isOpen });
  return null;
}

function render(isOpen?: boolean) {
  act(() => {
    root ??= createRoot(document.createElement("div"));
    root.render(<Harness isOpen={isOpen} />);
  });
}

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

describe("useDisclosure openCount", () => {
  it("counts each open, but not opening an open disclosure again", () => {
    render();
    expect(disclosure.openCount).toBe(0);

    act(() => disclosure.onOpen());
    act(() => disclosure.onOpen());
    expect(disclosure.openCount).toBe(1);

    act(() => disclosure.onClose());
    act(() => disclosure.onOpen());
    expect(disclosure.openCount).toBe(2);
  });

  it("counts opens made through the isOpen prop", () => {
    render(false);
    expect(disclosure.openCount).toBe(0);

    render(true);
    expect(disclosure.openCount).toBe(1);

    render(false);
    render(true);
    expect(disclosure.openCount).toBe(2);
  });
});
