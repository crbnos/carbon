import { describe, expect, it } from "vitest";
import { toWebhookBody } from "./webhook-body.ts";

// PUBLIC contract — these cases mirror the deleted `webhook` edge function
// (git history: packages/database/supabase/functions/webhook/index.ts), which
// is what customer endpoints actually received.
describe("toWebhookBody", () => {
  const row = { id: "c1", name: "Acme", companyId: "co1" };
  const prev = { id: "c1", name: "Acme Inc", companyId: "co1" };

  it("INSERT sends the new row as `record`, with no `old` key", () => {
    const body = toWebhookBody(
      { table: "customer", operation: "INSERT", new: row, old: null },
      "co1",
      "42"
    );
    expect(body).toEqual({
      type: "INSERT",
      record: row,
      companyId: "co1",
      table: "customer",
      eventId: "42"
    });
    expect(body).not.toHaveProperty("old");
  });

  it("UPDATE sends both `record` (new) and `old`", () => {
    expect(
      toWebhookBody(
        { table: "customer", operation: "UPDATE", new: row, old: prev },
        "co1",
        "42"
      )
    ).toEqual({
      type: "UPDATE",
      record: row,
      old: prev,
      companyId: "co1",
      table: "customer",
      eventId: "42"
    });
  });

  it("DELETE takes `record` from OLD and omits `old`", () => {
    // Getting this wrong hands consumers `record: null` on every delete.
    const body = toWebhookBody(
      { table: "customer", operation: "DELETE", new: null, old: row },
      "co1",
      "42"
    );
    expect(body).toEqual({
      type: "DELETE",
      record: row,
      companyId: "co1",
      table: "customer",
      eventId: "42"
    });
    expect(body).not.toHaveProperty("old");
  });

  it("TRUNCATE behaves like DELETE", () => {
    expect(
      toWebhookBody(
        { table: "customer", operation: "TRUNCATE", new: null, old: row },
        "co1",
        "42"
      )
    ).toEqual({
      type: "TRUNCATE",
      record: row,
      companyId: "co1",
      table: "customer",
      eventId: "42"
    });
  });

  it("never emits an `old` key for UPDATE when old is missing", () => {
    const body = toWebhookBody(
      { table: "customer", operation: "UPDATE", new: row, old: null },
      "co1",
      "42"
    );
    expect(body).toEqual({
      type: "UPDATE",
      record: row,
      companyId: "co1",
      table: "customer",
      eventId: "42"
    });
    expect(body).not.toHaveProperty("old");
  });

  it("normalises a missing row to null rather than undefined", () => {
    // undefined would drop `record` from the JSON body entirely.
    const body = toWebhookBody(
      { table: "customer", operation: "INSERT" },
      "co1",
      "42"
    );
    expect(body.record).toBeNull();
    expect(Object.keys(body)).toContain("record");
  });

  it("carries the event's table, not the subscription's", () => {
    expect(
      toWebhookBody(
        { table: "salesOrder", operation: "INSERT", new: row },
        "co2",
        "42"
      )
    ).toMatchObject({ table: "salesOrder", companyId: "co2" });
  });

  it("distinguishes two genuine UPDATEs to the same record", () => {
    // The reason eventId exists. Delivery is at-least-once, so consumers must
    // de-dup — but `type` + `record.id` is identical for every update to a row,
    // so de-duping on those would silently drop real changes. Only eventId
    // separates them.
    const first = toWebhookBody(
      { table: "customer", operation: "UPDATE", new: prev, old: row },
      "co1",
      "100"
    );
    const second = toWebhookBody(
      { table: "customer", operation: "UPDATE", new: row, old: prev },
      "co1",
      "101"
    );
    expect(first.type).toBe(second.type);
    expect((first.record as { id: string }).id).toBe(
      (second.record as { id: string }).id
    );
    expect(first.eventId).not.toBe(second.eventId);
  });

  it("gives a retried delivery the same eventId", () => {
    // eventId is the pgmq message id, which is also the Inngest idempotency
    // key — retries of one change reuse it, which is what makes it usable as a
    // de-duplication key rather than just a nonce.
    const attempt = () =>
      toWebhookBody(
        { table: "customer", operation: "INSERT", new: row },
        "co1",
        "77"
      );
    expect(attempt()).toEqual(attempt());
    expect(attempt().eventId).toBe("77");
  });
});
