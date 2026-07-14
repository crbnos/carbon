import { describe, expect, it } from "vitest";
import { visualForComponent } from "./visibility";

describe("visualForComponent", () => {
  it("shows earlier-step components solid", () => {
    expect(visualForComponent(0, 2, "ghost")).toBe("solid");
    expect(visualForComponent(1, 2, "hidden")).toBe("solid");
  });

  it("marks the active step's components active", () => {
    expect(visualForComponent(2, 2, "ghost")).toBe("active");
    expect(visualForComponent(0, 0, "hidden")).toBe("active");
  });

  it("renders later-step components per the future mode", () => {
    expect(visualForComponent(3, 1, "ghost")).toBe("ghost");
    expect(visualForComponent(3, 1, "hidden")).toBe("hidden");
    expect(visualForComponent(3, 1, "solid")).toBe("solid");
  });

  it("treats never-installed components exactly like future-step ones", () => {
    for (const mode of ["ghost", "hidden", "solid"] as const) {
      expect(visualForComponent(undefined, 0, mode)).toBe(
        visualForComponent(99, 0, mode)
      );
      expect(visualForComponent(undefined, 5, mode)).toBe(
        visualForComponent(99, 5, mode)
      );
    }
  });

  it("never promotes a never-installed component to solid via step position", () => {
    // Even at the last step, an unassigned component is not "already there"
    expect(visualForComponent(undefined, 10, "hidden")).toBe("hidden");
    expect(visualForComponent(undefined, 10, "ghost")).toBe("ghost");
  });
});
