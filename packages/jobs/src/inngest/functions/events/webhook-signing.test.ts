import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildWebhookEnvelope,
  projectTopicData,
  signWebhookBody,
  type WebhookEvent
} from "./webhook-signing";

const journalEvent: WebhookEvent = {
  table: "journal",
  operation: "UPDATE",
  recordId: "jr-1",
  timestamp: "2026-06-30T12:00:00.000Z",
  old: { id: "jr-1", status: "Draft", companyId: "co-1" },
  new: {
    id: "jr-1",
    journalEntryId: "JE-000123",
    postingDate: "2026-06-30",
    status: "Posted",
    externalId: "carta-sbc-2026-06",
    sourceSystem: "Carta",
    companyId: "co-1",
    // fields that must NOT leak into the curated projection:
    tags: ["secret"],
    customFields: { internal: true }
  }
};

describe("projectTopicData", () => {
  it("projects only curated journal fields (no raw row leak)", () => {
    const data = projectTopicData("journal_entry.posted", journalEvent.new);
    expect(data).toEqual({
      id: "jr-1",
      journalEntryId: "JE-000123",
      postingDate: "2026-06-30",
      status: "Posted",
      externalId: "carta-sbc-2026-06",
      sourceSystem: "Carta"
    });
    expect(data).not.toHaveProperty("tags");
    expect(data).not.toHaveProperty("customFields");
  });

  it("projects period identity for period.* topics", () => {
    const data = projectTopicData("period.closed", {
      id: "ap-1",
      fiscalYear: 2026,
      periodNumber: 6,
      closeStatus: "Closed",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      companyId: "co-1"
    });
    expect(data).toEqual({
      id: "ap-1",
      fiscalYear: 2026,
      periodNumber: 6,
      closeStatus: "Closed",
      startDate: "2026-06-01",
      endDate: "2026-06-30"
    });
  });

  it("returns an empty projection for an unknown topic (no leak)", () => {
    expect(projectTopicData("mystery.topic", journalEvent.new)).toEqual({});
  });
});

describe("buildWebhookEnvelope", () => {
  it("builds the curated envelope with companyId + occurredAt from the row/event", () => {
    const env = buildWebhookEnvelope(
      "msg-9",
      "journal_entry.posted",
      journalEvent
    );
    expect(env).toEqual({
      id: "msg-9",
      topic: "journal_entry.posted",
      companyId: "co-1",
      occurredAt: "2026-06-30T12:00:00.000Z",
      data: {
        id: "jr-1",
        journalEntryId: "JE-000123",
        postingDate: "2026-06-30",
        status: "Posted",
        externalId: "carta-sbc-2026-06",
        sourceSystem: "Carta"
      }
    });
  });
});

describe("signWebhookBody", () => {
  const secret = "whsec_test_secret";
  const timestamp = "2026-06-30T12:00:00.000Z";
  const body = JSON.stringify({ hello: "world" });

  it("produces a verifiable v1 HMAC-SHA256 signature", () => {
    const sig = signWebhookBody(secret, timestamp, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);

    // A consumer recomputes and compares.
    const expected = `v1=${createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex")}`;
    expect(sig).toBe(expected);
  });

  it("fails verification when the body is tampered with", () => {
    const sig = signWebhookBody(secret, timestamp, body);
    const tampered = JSON.stringify({ hello: "world", amount: 999999 });
    const recomputed = signWebhookBody(secret, timestamp, tampered);
    expect(recomputed).not.toBe(sig);
  });

  it("fails verification with the wrong secret", () => {
    const sig = signWebhookBody(secret, timestamp, body);
    expect(signWebhookBody("wrong", timestamp, body)).not.toBe(sig);
  });
});
