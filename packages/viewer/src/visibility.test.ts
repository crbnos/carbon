// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_VIEWS,
  GHOST_OCCLUDER_WEIGHT,
  occluderWeight,
  stepHiddenNodeIds,
  VIEW_MODES,
  viewForModes,
  visualForComponent
} from "./visibility";

describe("visualForComponent", () => {
  it("shows earlier-step components solid when no installed mode is given", () => {
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

  it("renders installed components per the installed mode", () => {
    expect(visualForComponent(0, 2, "ghost", "solid")).toBe("solid");
    expect(visualForComponent(0, 2, "ghost", "ghost")).toBe("ghost");
    expect(visualForComponent(0, 2, "ghost", "hidden")).toBe("hidden");
  });

  it.each([
    ["the active step", 2, 2, "ghost", "active"],
    ["a future component", 3, 1, "ghost", "ghost"],
    ["a future component", 3, 1, "hidden", "hidden"],
    ["a future component", 3, 1, "solid", "solid"],
    ["a never-installed component", undefined, 5, "hidden", "hidden"],
    ["a never-installed component", undefined, 5, "ghost", "ghost"]
  ] as const)(
    "never lets the installed mode change %s (step %s of %s, future %s)",
    (_, stepIndex, activeStep, futureMode, expected) => {
      for (const installed of ["solid", "ghost", "hidden"] as const) {
        expect(
          visualForComponent(stepIndex, activeStep, futureMode, installed)
        ).toBe(expected);
      }
    }
  );
});

describe("occluderWeight", () => {
  it("counts a solid component fully, whichever side of the step it is on", () => {
    expect(occluderWeight(0, 2, "solid", "solid")).toBe(1);
    expect(occluderWeight(5, 2, "solid", "solid")).toBe(1);
  });

  it("drops a hidden component out of the scoring entirely", () => {
    expect(occluderWeight(0, 2, "solid", "hidden")).toBeNull();
    expect(occluderWeight(5, 2, "hidden", "solid")).toBeNull();
  });

  it("discounts a ghosted component instead of dropping it", () => {
    expect(occluderWeight(0, 2, "solid", "ghost")).toBe(GHOST_OCCLUDER_WEIGHT);
    expect(occluderWeight(5, 2, "ghost", "solid")).toBe(GHOST_OCCLUDER_WEIGHT);
    expect(GHOST_OCCLUDER_WEIGHT).toBeGreaterThan(0);
    expect(GHOST_OCCLUDER_WEIGHT).toBeLessThan(1);
  });

  it("applies each mode only to its own side of the active step", () => {
    // Hiding the installed side must not drop a future occluder, and vice versa
    expect(occluderWeight(5, 2, "solid", "hidden")).toBe(1);
    expect(occluderWeight(0, 2, "hidden", "solid")).toBe(1);
  });

  it("treats the active step's own components as full occluders", () => {
    // The caller filters these out by nodeId before asking; if one does reach
    // here it must never be discounted away.
    for (const mode of ["solid", "ghost", "hidden"] as const) {
      expect(occluderWeight(2, 2, mode, mode)).toBe(1);
    }
  });

  it("treats never-installed components exactly like future ones", () => {
    // visualForComponent renders them per the FUTURE mode — they are never
    // "already there" — so the occluder scoring must follow the same mode.
    for (const mode of ["solid", "ghost", "hidden"] as const) {
      expect(occluderWeight(undefined, 3, mode, "solid")).toBe(
        occluderWeight(99, 3, mode, "solid")
      );
    }
    expect(occluderWeight(undefined, 3, "hidden", "solid")).toBeNull();
    expect(occluderWeight(undefined, 3, "ghost", "solid")).toBe(
      GHOST_OCCLUDER_WEIGHT
    );
    // The installed mode must never touch them.
    for (const mode of ["solid", "ghost", "hidden"] as const) {
      expect(occluderWeight(undefined, 3, "solid", mode)).toBe(1);
    }
  });

  it("stays consistent with visualForComponent: invisible implies not an occluder", () => {
    const steps = [undefined, 0, 1, 2, 3, 4];
    const modes = ["solid", "ghost", "hidden"] as const;
    for (const stepIndex of steps) {
      for (const future of modes) {
        for (const installed of modes) {
          const visual = visualForComponent(stepIndex, 2, future, installed);
          const weight = occluderWeight(stepIndex, 2, future, installed);
          if (visual === "hidden") {
            expect(weight).toBeNull();
          } else {
            expect(weight).not.toBeNull();
          }
        }
      }
    }
  });
});

describe("named views", () => {
  it("keeps 'build' a no-op for callers that pass no installed mode", () => {
    // Those callers render installed parts solid and default the future to hidden.
    expect(VIEW_MODES.build).toEqual({
      installedMode: "solid",
      futureMode: "hidden"
    });
  });

  it("round-trips every view through viewForModes", () => {
    for (const view of ASSEMBLY_VIEWS) {
      const { installedMode, futureMode } = VIEW_MODES[view];
      expect(viewForModes(installedMode, futureMode)).toBe(view);
    }
  });

  it.each([
    ["hidden", "solid"],
    ["hidden", "hidden"]
  ] as const)(
    "falls back to 'build' for the unnamed pair installed %s / future %s",
    (installed, future) => {
      expect(viewForModes(installed, future)).toBe("build");
    }
  );

  it("ghosts the built side in 'focus' and still counts it as a weak occluder", () => {
    const { installedMode, futureMode } = VIEW_MODES.focus;
    expect(visualForComponent(0, 2, futureMode, installedMode)).toBe("ghost");
    expect(occluderWeight(0, 2, futureMode, installedMode)).toBe(
      GHOST_OCCLUDER_WEIGHT
    );
  });
});

describe("stepHiddenNodeIds", () => {
  it("hides the active step's authored hidden list", () => {
    const hidden = stepHiddenNodeIds({
      componentNodeIds: ["bearing"],
      hiddenComponentNodeIds: ["press-tool", "fixture"]
    });
    expect([...hidden].sort()).toEqual(["fixture", "press-tool"]);
  });

  it("never hides the parts the step itself installs", () => {
    const hidden = stepHiddenNodeIds({
      componentNodeIds: ["bearing"],
      hiddenComponentNodeIds: ["bearing", "press-tool"]
    });
    expect([...hidden]).toEqual(["press-tool"]);
  });

  it("hides nothing when no step is active or none is authored", () => {
    expect(stepHiddenNodeIds(null).size).toBe(0);
    expect(stepHiddenNodeIds({ componentNodeIds: ["bearing"] }).size).toBe(0);
  });
});
