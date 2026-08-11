import { describe, expect, it } from "vitest";
import {
  getWorkflowDispatch,
  setWorkflowDispatch,
  type WorkflowDispatch
} from "./dispatcher";

describe("the workflow dispatch seam", () => {
  it("has nothing until the app registers one", () => {
    expect(getWorkflowDispatch()).toBeUndefined();
  });

  it("hands back exactly what was registered", async () => {
    const fake: WorkflowDispatch = async () => ({ success: true, data: null });
    setWorkflowDispatch(fake);
    expect(getWorkflowDispatch()).toBe(fake);
  });
});
