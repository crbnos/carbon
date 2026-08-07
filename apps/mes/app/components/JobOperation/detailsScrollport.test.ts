import { describe, expect, it } from "vitest";
import { DETAILS_SCROLLPORT_CLASSNAME } from "./detailsScrollport";

describe("DETAILS_SCROLLPORT_CLASSNAME (#959 mobile files)", () => {
  it("does not force a fixed height on small viewports", () => {
    // A bare `h-[calc(...)]` without an `lg:` prefix would reintroduce the
    // nested-scroll trap that hid Files on mobile.
    const tokens = DETAILS_SCROLLPORT_CLASSNAME.split(/\s+/);
    expect(tokens).toContain("h-auto");
    expect(
      tokens.some(
        (t) => t.startsWith("h-[") && !t.startsWith("lg:h-[") && t !== "h-auto"
      )
    ).toBe(false);
  });

  it("keeps the desktop fixed-height scrollport at lg+", () => {
    expect(DETAILS_SCROLLPORT_CLASSNAME).toContain(
      "lg:h-[calc(100dvh-var(--header-height)*2-var(--controls-height)-2rem)]"
    );
    expect(DETAILS_SCROLLPORT_CLASSNAME).toContain("lg:overflow-y-auto");
    expect(DETAILS_SCROLLPORT_CLASSNAME).toContain(
      "lg:pr-[var(--controls-gutter)]"
    );
  });
});
