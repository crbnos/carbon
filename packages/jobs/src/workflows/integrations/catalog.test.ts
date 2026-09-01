import { describe, expect, it } from "vitest";
import { buildPieceActionDeclarations } from "./catalog";
import { toValueType, UnmappablePropertyError } from "./properties";

describe("buildPieceActionDeclarations (slack)", () => {
  it("emits the four allowlisted slack steps with omitted props absent", async () => {
    const all = await buildPieceActionDeclarations();
    const ids = Object.keys(all).filter((id) =>
      id.startsWith("integration.slack.")
    );
    expect(ids.sort()).toEqual([
      "integration.slack.send_channel_message",
      "integration.slack.send_direct_message",
      "integration.slack.slack-create-channel",
      "integration.slack.slack-find-user-by-email"
    ]);

    const send = all["integration.slack.send_channel_message"]!;
    expect(Object.keys(send.inputs).sort()).toEqual(
      [
        "connectionId",
        "channel",
        "text",
        "threadTs",
        "username",
        "profilePicture",
        "iconEmoji",
        "replyBroadcast",
        "unfurlLinks"
      ].sort()
    );
    expect(send.advancedInputs).toBeUndefined();
    for (const gone of [
      "info",
      "file",
      "blocks",
      "sendAsBot",
      "mentionOriginFlow"
    ]) {
      expect(send.inputs).not.toHaveProperty(gone);
    }
    expect(send.inputs.channel!.options?.provider).toBe("integration.property");
    expect(send.outputs).toHaveProperty("count");
    expect(send.outputs).toHaveProperty("result");

    const dm = all["integration.slack.send_direct_message"]!;
    expect(dm.inputs).not.toHaveProperty("blocks");
    expect(dm.inputs).not.toHaveProperty("mentionOriginFlow");
    expect(dm.inputs.userId!.options?.provider).toBe("integration.property");
  });

  // Omission is explicit. A merely hidden (or untouched) unmappable prop still refuses,
  // so nothing is dropped from a form silently.
  it("still refuses an unmappable prop that was not omitted", () => {
    expect(() =>
      toValueType("p", "a", "blocks", { type: "JSON", required: false })
    ).toThrow(UnmappablePropertyError);
  });
});
