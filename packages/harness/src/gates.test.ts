import { describe, expect, it } from "vitest";
import { type Exec, FLOOR_GATES, runGates } from "./gates";

describe("runGates", () => {
  it("runs each gate via the injected exec and reports pass/fail", () => {
    const exec: Exec = (cmd) => ({
      ok: !cmd.includes("clobbers"),
      output: cmd
    });
    const gates = [
      { id: "lint", cmd: "biome check" },
      { id: "clobbers", cmd: "pnpm clobbers" }
    ];
    const results = runGates(gates, exec);
    expect(results).toEqual([
      { id: "lint", passed: true, output: "biome check" },
      { id: "clobbers", passed: false, output: "pnpm clobbers" }
    ]);
  });

  it("ships a non-empty FLOOR_GATES list", () => {
    expect(FLOOR_GATES.length).toBeGreaterThan(0);
    expect(FLOOR_GATES.every((g) => g.id && g.cmd)).toBe(true);
  });
});
