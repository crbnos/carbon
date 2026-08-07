import { describe, expect, it } from "vitest";
import { DETAILS_SCROLLPORT_CLASSNAME } from "./detailsScrollport";

describe("DETAILS_SCROLLPORT_CLASSNAME (#959 mobile files)", () => {
  it("does not force a fixed height on small viewports", () => {
    // Any fixed-height utility before `lg` (h-screen, h-full, h-[...],
    // sm:/md: variants) would reintroduce the nested-scroll trap that hid
    // Files / Serial Numbers on mobile.
    const tokens = DETAILS_SCROLLPORT_CLASSNAME.split(/\s+/);
    expect(tokens).toContain("h-auto");
    expect(
      tokens.some(
        (t) =>
          /^(?:h-|sm:h-|md:h-)/.test(t) &&
          t !== "h-auto" &&
          !t.endsWith(":h-auto")
      )
    ).toBe(false);
    expect(tokens).toContain("overflow-y-visible");
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
