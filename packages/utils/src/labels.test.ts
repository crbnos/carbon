// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { canResendToPrinter } from "./labels";

describe("canResendToPrinter", () => {
  it("refuses a 203 dpi label for a 300 dpi printer", () => {
    expect(canResendToPrinter("zpl", 203, 300)).toBe(false);
  });

  it("refuses a 600 dpi label for a 203 dpi printer", () => {
    expect(canResendToPrinter("zpl", 600, 203)).toBe(false);
  });

  it("sends a label to a printer at its own dpi", () => {
    expect(canResendToPrinter("zpl", 300, 300)).toBe(true);
  });

  it("sends a PDF to a printer at any dpi", () => {
    expect(canResendToPrinter("pdf", 203, 600)).toBe(true);
  });

  it.each([null, undefined])(
    "sends a label to a printer with no known dpi (%s)",
    (printerDpi) => {
      expect(canResendToPrinter("zpl", 203, printerDpi)).toBe(true);
    }
  );
});
