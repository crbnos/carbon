import { NotificationEvent } from "@carbon/notifications";
import type { RuntimeValue } from "@carbon/workflows";
import { entityValue, primitiveValue } from "@carbon/workflows";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runNotifyAction } from "./notify";

const { triggerMock } = vi.hoisted(() => ({ triggerMock: vi.fn() }));
vi.mock("@carbon/lib/trigger", () => ({ trigger: triggerMock }));

function run(inputs: Record<string, RuntimeValue>) {
  return runNotifyAction({
    companyId: "cmp_1",
    runId: "run_1",
    inputs
  });
}

const subject = primitiveValue("string", "Order held");

describe("runNotifyAction", () => {
  beforeEach(() => {
    triggerMock.mockReset();
    triggerMock.mockResolvedValue(undefined);
  });

  it("sends one event naming the person when only a user is given", async () => {
    const outcome = await run({ user: entityValue("user", "usr_1"), subject });

    expect(outcome).toEqual({
      ok: true,
      outputs: {},
      summary: "Notified 1 recipient(s)."
    });
    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(triggerMock).toHaveBeenCalledWith(
      "notify",
      expect.objectContaining({
        event: NotificationEvent.Workflow,
        recipient: { type: "group", groupIds: ["usr_1"] },
        title: "Order held"
      })
    );
  });

  // The notify job drops the sender from the recipients so nobody hears about their own
  // action. Naming the owner here made "notify me when X happens" — the common case —
  // deliver nothing while the step still reported success.
  it("names no sender, so the owner can be notified by their own workflow", async () => {
    await run({ user: entityValue("user", "usr_owner"), subject });

    expect(triggerMock.mock.calls[0]?.[1]).not.toHaveProperty("from");
  });

  it("sends one event carrying both ids when a user and a role are given", async () => {
    await run({
      user: entityValue("user", "usr_1"),
      role: entityValue("group", "grp_1"),
      subject,
      message: primitiveValue("string", "Please review it.")
    });

    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(triggerMock).toHaveBeenCalledWith(
      "notify",
      expect.objectContaining({
        body: "Please review it.",
        recipient: { type: "group", groupIds: ["usr_1", "grp_1"] }
      })
    );
  });

  it("refuses and sends nothing when neither a user nor a role is given", async () => {
    const outcome = await run({ subject });

    expect(outcome).toEqual({
      ok: false,
      error: "This step has nobody to notify."
    });
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("falls back to the run id as the document when no record is named", async () => {
    await run({ user: entityValue("user", "usr_1"), subject });
    expect(triggerMock).toHaveBeenCalledWith(
      "notify",
      expect.objectContaining({ documentId: "run_1" })
    );

    triggerMock.mockClear();
    await run({
      user: entityValue("user", "usr_1"),
      subject,
      aboutId: primitiveValue("string", "job_1"),
      aboutType: primitiveValue("string", "job")
    });
    expect(triggerMock).toHaveBeenCalledWith(
      "notify",
      expect.objectContaining({ documentId: "job_1", documentType: "job" })
    );
  });
});
