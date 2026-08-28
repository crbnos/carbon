import { describe, expect, it } from "vitest";
import {
  getWorkflowServiceUserId,
  isWorkflowServiceUserId,
  WORKFLOW_SERVICE_USER_PREFIX
} from "./owner";

describe("workflow service identity", () => {
  it("derives the id from the company id", () => {
    expect(getWorkflowServiceUserId("cmp_abc")).toBe("wfsvc_cmp_abc");
  });

  // The id is derived rather than generated so provisioning is idempotent —
  // the migration's backfill and seed-company must land on the same row.
  it("is stable for the same company", () => {
    expect(getWorkflowServiceUserId("cmp_abc")).toBe(
      getWorkflowServiceUserId("cmp_abc")
    );
  });

  it("is distinct per company", () => {
    expect(getWorkflowServiceUserId("cmp_a")).not.toBe(
      getWorkflowServiceUserId("cmp_b")
    );
  });

  it("recognises its own ids", () => {
    expect(isWorkflowServiceUserId(getWorkflowServiceUserId("cmp_abc"))).toBe(
      true
    );
  });

  // The UI branches on this to render "Company" instead of a nameless avatar,
  // so a false positive would relabel a real person.
  it("does not claim ordinary or sentinel user ids", () => {
    expect(isWorkflowServiceUserId("usr_abc")).toBe(false);
    expect(isWorkflowServiceUserId("system")).toBe(false);
    expect(isWorkflowServiceUserId("")).toBe(false);
    expect(isWorkflowServiceUserId(null)).toBe(false);
  });

  it("keeps the prefix in step with the SQL provisioning function", () => {
    expect(WORKFLOW_SERVICE_USER_PREFIX).toBe("wfsvc_");
  });
});
