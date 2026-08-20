import { beforeEach, describe, expect, it } from "vitest";
import {
  publishVariableMenuData,
  readVariableMenuData,
  retractVariableMenuData
} from "./menuBridge";

const data = (label: string) => () => ({
  tree: [{ key: label, label }],
  flat: [{ id: label, label }]
});

describe("menuBridge", () => {
  const a = data("a");
  const b = data("b");

  beforeEach(() => {
    retractVariableMenuData(a);
    retractVariableMenuData(b);
  });

  it("reads an empty menu when nobody has published", () => {
    expect(readVariableMenuData()).toEqual({ tree: [], flat: [] });
  });

  it("reads the last publisher", () => {
    publishVariableMenuData(a);
    publishVariableMenuData(b);
    expect(readVariableMenuData().tree[0].key).toBe("b");
  });

  it("ignores a retraction from an editor that no longer holds the slot", () => {
    publishVariableMenuData(a);
    publishVariableMenuData(b);
    // `a` unmounting must not blank the menu the user is currently typing into.
    retractVariableMenuData(a);
    expect(readVariableMenuData().tree[0].key).toBe("b");
  });

  it("clears the slot when its own owner retracts", () => {
    publishVariableMenuData(a);
    retractVariableMenuData(a);
    expect(readVariableMenuData()).toEqual({ tree: [], flat: [] });
  });
});
