import { describe, expect, it } from "vitest";
import { toWebhookBody } from "./webhook.ts";

// The body shape is a PUBLIC contract: it is byte-for-byte what the `webhook`
// edge function (the tail of the old pg_net trigger path) POSTed to customer
// endpoints. Migrating off those triggers must not change it, so these cases
// mirror that now-deleted function — including `companyId`/`table`, which the
// triggers passed through and it forwarded. See git history at
// packages/database/supabase/functions/webhook/index.ts, and the public
// contract in docs/content/docs/building/webhooks.mdx.
describe("toWebhookBody", () => {
  const row = { id: "c1", name: "Acme", companyId: "co1" };
  const prev = { id: "c1", name: "Acme Inc", companyId: "co1" };

  it("INSERT sends the new row as `record`, with no `old` key", () => {
    const body = toWebhookBody(
      { table: "customer", operation: "INSERT", new: row, old: null },
      "co1"
    );
    expect(body).toEqual({
      type: "INSERT",
      record: row,
      companyId: "co1",
      table: "customer"
    });
    // The trigger sent `'old', NULL` and the edge fn spreads it conditionally,
    // so the key must be ABSENT rather than null.
    expect(body).not.toHaveProperty("old");
  });

  it("UPDATE sends both `record` (new) and `old`", () => {
    expect(
      toWebhookBody(
        { table: "customer", operation: "UPDATE", new: row, old: prev },
        "co1"
      )
    ).toEqual({
      type: "UPDATE",
      record: row,
      old: prev,
      companyId: "co1",
      table: "customer"
    });
  });

  it("DELETE takes `record` from OLD and omits `old`", () => {
    // The subtle one: the queue event carries the row under `old` because `new`
    // is null, but the trigger sent it as `record`. Getting this wrong hands
    // consumers `record: null` on every delete.
    const body = toWebhookBody(
      { table: "customer", operation: "DELETE", new: null, old: row },
      "co1"
    );
    expect(body).toEqual({
      type: "DELETE",
      record: row,
      companyId: "co1",
      table: "customer"
    });
    expect(body).not.toHaveProperty("old");
  });

  it("TRUNCATE behaves like DELETE", () => {
    expect(
      toWebhookBody(
        { table: "customer", operation: "TRUNCATE", new: null, old: row },
        "co1"
      )
    ).toEqual({
      type: "TRUNCATE",
      record: row,
      companyId: "co1",
      table: "customer"
    });
  });

  it("never emits an `old` key for UPDATE when old is missing", () => {
    const body = toWebhookBody(
      { table: "customer", operation: "UPDATE", new: row, old: null },
      "co1"
    );
    expect(body).toEqual({
      type: "UPDATE",
      record: row,
      companyId: "co1",
      table: "customer"
    });
    expect(body).not.toHaveProperty("old");
  });

  it("normalises a missing row to null rather than undefined", () => {
    // undefined would drop `record` from the JSON body entirely.
    const body = toWebhookBody(
      { table: "customer", operation: "INSERT" },
      "co1"
    );
    expect(body.record).toBeNull();
    expect(Object.keys(body)).toContain("record");
  });

  it("carries the event's table, not the subscription's", () => {
    // `table` comes off the event so a subscription pointed at a renamed table
    // can't mislabel the payload.
    expect(
      toWebhookBody(
        { table: "salesOrder", operation: "INSERT", new: row },
        "co2"
      )
    ).toMatchObject({ table: "salesOrder", companyId: "co2" });
  });
});
