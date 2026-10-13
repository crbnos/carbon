// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OperatingSystemContextProvider } from "./OperatingSystem";
import type { SignatureContext } from "./SignaturePad";
import { createSignatureDrawing, SignaturePad } from "./SignaturePad";

// The test runs without the Lingui macro transform: `t` returns the source
// text.
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values)
  })
}));

function fakeContext() {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.join(",")})`);
    };
  const context: SignatureContext = {
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    quadraticCurveTo: record("quadraticCurveTo"),
    stroke: record("stroke"),
    clearRect: record("clearRect"),
    save: record("save"),
    restore: record("restore"),
    setTransform: record("setTransform"),
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter"
  };
  return { context, calls };
}

describe("SignaturePad", () => {
  it("renders a canvas and a Clear button", () => {
    const html = renderToStaticMarkup(
      <OperatingSystemContextProvider platform="mac">
        <SignaturePad />
      </OperatingSystemContextProvider>
    );
    expect(html).toContain("<canvas");
    expect(html).toContain("touch-action:none");
    expect(html).toContain("Clear");
  });

  it("calls onChange(true) when it is cleared", () => {
    const { context, calls } = fakeContext();
    const onChange = vi.fn();
    const drawing = createSignatureDrawing({
      getContext: () => context,
      getSize: () => ({ width: 300, height: 160 }),
      getColor: () => "black",
      onChange
    });

    drawing.start({ x: 10, y: 10 });
    drawing.move({ x: 20, y: 15 });
    drawing.move({ x: 30, y: 25 });
    drawing.end();
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(drawing.isEmpty()).toBe(false);
    expect(calls).toContain("quadraticCurveTo(20,15,25,20)");

    drawing.clear();
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(drawing.isEmpty()).toBe(true);
    expect(calls).toContain("clearRect(0,0,300,160)");
  });
});
