import { describe, expect, it } from "vitest";
import { toWebhookBody } from "./webhook.ts";

// The body shape is a PUBLIC contract: it is byte-for-byte what the pg_net
// trigger path (webhook_insert/_update/_delete -> the `webhook` edge function)
// has been POSTing to customer endpoints. Migrating those triggers onto the
// event system must not change it, so these cases mirror the SQL exactly.
describe("toWebhookBody", () => {
  const row = { id: "c1", name: "Acme", companyId: "co1" };
  const prev = { id: "c1", name: "Acme Inc", companyId: "co1" };

  it("INSERT sends the new row as `record`, with no `old` key", () => {
    const body = toWebhookBody({
      table: "customer",
      operation: "INSERT",
      new: row,
      old: null
    });
    expect(body).toEqual({ type: "INSERT", record: row });
    // The trigger sends `old: NULL` and the edge fn spreads it conditionally,
    // so the key must be ABSENT rather than null.
    expect(body).not.toHaveProperty("old");
  });

  it("UPDATE sends both `record` (new) and `old`", () => {
    expect(
      toWebhookBody({
        table: "customer",
        operation: "UPDATE",
        new: row,
        old: prev
      })
    ).toEqual({ type: "UPDATE", record: row, old: prev });
  });

  it("DELETE takes `record` from OLD and omits `old`", () => {
    // The subtle one: the queue event carries the row under `old` because `new`
    // is null, but the trigger sent it as `record`. Getting this wrong hands
    // consumers `record: null` on every delete.
    const body = toWebhookBody({
      table: "customer",
      operation: "DELETE",
      new: null,
      old: row
    });
    expect(body).toEqual({ type: "DELETE", record: row });
    expect(body).not.toHaveProperty("old");
  });

  it("TRUNCATE behaves like DELETE", () => {
    expect(
      toWebhookBody({
        table: "customer",
        operation: "TRUNCATE",
        new: null,
        old: row
      })
    ).toEqual({ type: "TRUNCATE", record: row });
  });

  it("never emits an `old` key for UPDATE when old is missing", () => {
    const body = toWebhookBody({
      table: "customer",
      operation: "UPDATE",
      new: row,
      old: null
    });
    expect(body).toEqual({ type: "UPDATE", record: row });
    expect(body).not.toHaveProperty("old");
  });

  it("normalises a missing row to null rather than undefined", () => {
    // undefined would drop `record` from the JSON body entirely.
    const body = toWebhookBody({ table: "customer", operation: "INSERT" });
    expect(body.record).toBeNull();
    expect(Object.keys(body)).toContain("record");
  });
});
