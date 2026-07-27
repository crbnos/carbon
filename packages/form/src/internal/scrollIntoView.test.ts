import { describe, expect, it } from "vitest";
import { getCenteredScrollTop } from "./scrollIntoView";

// Geometry of the job details page (`x+/job+/$jobId.details.tsx`): the invalid
// field sits inside an operation card far down the Bill of Process, and the
// scroll container is the panel wrapper that starts 99px below the viewport top.
// `element.offsetTop` is NOT usable here — SortableList renders each operation as
// a `position: relative` Reorder.Item, so offsetTop measures from the card, not
// from the scroll container.
const jobPageGeometry = {
  element: { top: 2100, height: 40 },
  container: { top: 99, height: 800, scrollTop: 0 }
};

describe("getCenteredScrollTop", () => {
  it("scrolls to the field's real offset in the container, not its offset within the card", () => {
    // 2100 - 99 = 2001px into the container's content, centered in an 800px viewport.
    expect(getCenteredScrollTop(jobPageGeometry)).toBe(1621);
  });

  it("accounts for how far the container is already scrolled", () => {
    expect(
      getCenteredScrollTop({
        ...jobPageGeometry,
        container: { ...jobPageGeometry.container, scrollTop: 500 }
      })
    ).toBe(2121);
  });

  it("never returns a negative scroll offset for a field above the fold", () => {
    expect(
      getCenteredScrollTop({
        element: { top: 120, height: 40 },
        container: { top: 99, height: 800, scrollTop: 0 }
      })
    ).toBe(0);
  });
});
