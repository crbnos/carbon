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
    // Slack's "Message" is a LongText: the multiline editor.
    expect(send.inputs.text!.template).toBe(true);
    // Posted as mrkdwn blocks, so a record can be a real <url|label> link.
    expect(send.inputs.text!.links).toEqual({ format: "slack" });
    expect(send.outputs).toHaveProperty("count");
    expect(send.outputs).toHaveProperty("result");

    const dm = all["integration.slack.send_direct_message"]!;
    expect(dm.inputs.text!.links).toEqual({ format: "slack" });
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

describe("buildPieceActionDeclarations (gmail)", () => {
  it("emits the one send step with the send-only prop set", async () => {
    const all = await buildPieceActionDeclarations();
    const ids = Object.keys(all).filter((id) =>
      id.startsWith("integration.gmail.")
    );
    expect(ids).toEqual(["integration.gmail.gmail_send_email"]);

    const send = all["integration.gmail.gmail_send_email"]!;
    expect(Object.keys(send.inputs).sort()).toEqual(
      [
        "connectionId",
        "receiver",
        "cc",
        "bcc",
        "subject",
        "body",
        "reply_to",
        "sender_name",
        "from"
      ].sort()
    );
    // Required with a vendor default: hidden, still reachable, sent as plain_text.
    expect(Object.keys(send.advancedInputs ?? {})).toEqual(["body_type"]);
    for (const gone of ["attachments", "in_reply_to", "draft"]) {
      expect(send.inputs).not.toHaveProperty(gone);
      expect(send.advancedInputs ?? {}).not.toHaveProperty(gone);
    }
    expect(send.inputs.receiver!.type).toEqual({
      kind: "list",
      of: { kind: "primitive", of: "string" }
    });
    // The body is a ShortText upstream; the allowlist says it is prose.
    expect(send.inputs.body!.template).toBe(true);
    // Links only in an html body; the subject never links.
    expect(send.inputs.body!.links).toEqual({
      format: "html",
      when: { input: "body_type", equals: ["html"] }
    });
    expect(send.inputs.subject!.links).toBeUndefined();
    expect(send.outputs).toHaveProperty("count");
    expect(send.outputs).toHaveProperty("result");
  });
});
