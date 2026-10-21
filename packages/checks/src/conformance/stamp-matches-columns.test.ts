// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findStampColumnMismatches } from "./stamp-matches-columns";

const COLUMNS = new Map([
  [
    "account",
    new Set(["id", "name", "companyGroupId", "createdBy", "updatedBy"])
  ],
  ["itemCost", new Set(["itemId", "companyId", "createdBy", "updatedBy"])],
  ["contact", new Set(["id", "companyId", "firstName"])]
]);

const SERVICE = `
export async function upsertAccount(client, account: { name: string }) {
  if ("createdBy" in account) {
    return client.from("account").insert([account]).select("*").single();
  }
  return client.from("account").update(sanitize(account)).eq("id", account.id);
}
export async function upsertItemCost(client, itemCost: { itemId: string }) {
  return client.from("itemCost").update(sanitize(itemCost)).eq("itemId", itemCost.itemId);
}
export async function insertContact(client, payload: { contact: object }) {
  return client.from("contact").insert([{ ...payload.contact, isCustomer: true }]);
}
export async function upsertRecord(client, record: { name: string }) {
  if ("createdBy" in record) {
    const data = sanitize(record);
    return client.from("itemCost").insert([data]);
  }
  return client.from("itemCost").update(sanitize({ ...record })).eq("itemId", "x");
}
export async function insertRows(client, rows: { name: string }[]) {
  return client.from("account").insert(rows);
}
`;

function findings(server: string) {
  return findStampColumnMismatches(
    [
      {
        server: { file: "m/m.server.ts", contents: server },
        service: { file: "m/m.service.ts", contents: SERVICE }
      }
    ],
    COLUMNS
  ).map((v) => v.snippet);
}

const leaf = (name: string, call: string) => `
export const ${name} = defineServiceFn({
  async run(ctx, input) {
    return unwrap(ctx, await ${call});
  }
});
`;

describe("stamp-matches-columns", () => {
  it("fails a stamped field the written table has no column for", () => {
    expect(
      findings(
        leaf(
          "createAccount",
          `service.upsertAccount(ctx.asCaller.supabase, payload(ctx, input).withGroup().forCreate())`
        )
      )
    ).toEqual(["createAccount account companyId"]);
  });

  it("fails createdBy stamped onto a payload that only reaches an update", () => {
    expect(
      findings(
        leaf(
          "upsertItemCost",
          `service.upsertItemCost(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().forUpsert())`
        )
      )
    ).toEqual(["upsertItemCost createdBy-on-update"]);
  });

  it("passes updatedBy on an update, and createdBy dropped by the update operation", () => {
    expect(
      findings(
        leaf(
          "upsertItemCost",
          `service.upsertItemCost(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().forUpdate())`
        ) +
          leaf(
            "updateAccount",
            `service.upsertAccount(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().forUpdate())`
          )
      )
    ).toEqual([]);
  });

  it("follows a local initialized from the payload", () => {
    expect(
      findings(
        leaf(
          "createRecord",
          `service.upsertRecord(ctx.asCaller.supabase, payload(ctx, input).withoutCompany().withGroup().forCreate())`
        )
      )
    ).toEqual(["createRecord itemCost companyGroupId"]);
  });

  it("does not follow a nested object stamp never adds fields to", () => {
    expect(
      findings(
        leaf(
          "insertContact",
          `service.insertContact(ctx.asCaller.supabase, payload(ctx, input).forUpsert())`
        )
      )
    ).toEqual([]);
  });

  it("checks only createdBy on a list, the one field stamp adds to each row", () => {
    expect(
      findings(
        leaf(
          "insertRows",
          `service.insertRows(ctx.asCaller.supabase, payload(ctx, input.rows).forCreate())`
        )
      )
    ).toEqual([]);
  });
});
