import { describe, expect, it } from "vitest";
import type { SequenceState } from "../hooks/useShortcutSequence";
import { sequenceStep } from "../hooks/useShortcutSequence";

const config = { prefix: "g", keys: new Set(["s", "p"]) };
const idle: SequenceState = { armedAt: null, lastPrintableAt: null };

const key = (
  k: string,
  modifiers: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">> = {}
) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...modifiers });

describe("sequenceStep", () => {
  it("arms on the bare prefix, then matches a map key", () => {
    const armed = sequenceStep(idle, key("g"), 1000, config);
    expect(armed.state.armedAt).toBe(1000);
    expect(armed.match).toBeUndefined();

    const matched = sequenceStep(armed.state, key("s"), 1200, config);
    expect(matched.match).toBe("s");
    expect(matched.state.armedAt).toBeNull();
  });

  it("does not match after the timeout window", () => {
    const armed = sequenceStep(idle, key("g"), 1000, config);
    const late = sequenceStep(armed.state, key("s"), 2600, config);
    expect(late.match).toBeUndefined();
  });

  it("a non-matching key (Escape included) disarms without matching", () => {
    const armed = sequenceStep(idle, key("g"), 1000, config);
    const disarmed = sequenceStep(armed.state, key("Escape"), 1100, config);
    expect(disarmed.match).toBeUndefined();
    expect(disarmed.state.armedAt).toBeNull();
    const after = sequenceStep(disarmed.state, key("s"), 1200, config);
    expect(after.match).toBeUndefined();
  });

  it("any modifier disarms and never arms", () => {
    const armed = sequenceStep(idle, key("g"), 1000, config);
    const modified = sequenceStep(
      armed.state,
      key("s", { metaKey: true }),
      1100,
      config
    );
    expect(modified.match).toBeUndefined();
    expect(modified.state.armedAt).toBeNull();

    const noArm = sequenceStep(idle, key("g", { ctrlKey: true }), 1000, config);
    expect(noArm.state.armedAt).toBeNull();
  });

  it("ignores a prefix arriving inside a scanner burst", () => {
    const typed = sequenceStep(idle, key("x"), 1000, config);
    const burstPrefix = sequenceStep(typed.state, key("g"), 1020, config);
    expect(burstPrefix.state.armedAt).toBeNull();

    const humanPrefix = sequenceStep(typed.state, key("g"), 1400, config);
    expect(humanPrefix.state.armedAt).toBe(1400);
  });

  it("matching is case-insensitive on the incoming key", () => {
    const armed = sequenceStep(idle, key("g"), 1000, config);
    expect(sequenceStep(armed.state, key("S"), 1100, config).match).toBe("s");
  });
});
