// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Finalizing a quote keeps the Send Via picked (`quote.sendViaEmail`), which
// the Won drawer starts the order's Send Via from.
// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one.

import { afterAll, beforeAll, expect } from "vitest";
import { finalizeQuote } from "../../app/modules/sales/sales.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

let f: Fixture;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await f.cleanup();
}, 120_000);

// A Draft quote with the given stored Send Via. Returns its id.
async function draftQuote(name: string, sendViaEmail: boolean) {
  const id = `${f.prefix}-${name}`;
  await seed(f, (trx) =>
    trx
      .insertInto("quote")
      .values({
        id,
        quoteId: `Q-${name}`,
        customerId: f.customerId,
        status: "Draft",
        currencyCode: "USD",
        exchangeRate: 1,
        sendViaEmail,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute()
  );
  return id;
}

async function storedQuote(id: string) {
  return f.db
    .selectFrom("quote")
    .select(["status", "sendViaEmail"])
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

postgrestTest("finalizing with None stores Send Via as not email", async (client) => {
  const id = await draftQuote("none", true);
  const result = await finalizeQuote(client, id, USER, f.companyId, {
    notification: "None"
  });
  expect(result.error).toBeNull();
  expect(await storedQuote(id)).toEqual({ status: "Sent", sendViaEmail: false });
});

postgrestTest("finalizing with Email stores Send Via as email", async (client) => {
  const id = await draftQuote("email", false);
  const result = await finalizeQuote(client, id, USER, f.companyId, {
    notification: "Email"
  });
  expect(result.error).toBeNull();
  expect(await storedQuote(id)).toEqual({ status: "Sent", sendViaEmail: true });
});

postgrestTest(
  "finalizing with no Send Via (email not set up) leaves the stored choice",
  async (client) => {
    const id = await draftQuote("omitted", false);
    const result = await finalizeQuote(client, id, USER, f.companyId);
    expect(result.error).toBeNull();
    expect(await storedQuote(id)).toEqual({
      status: "Sent",
      sendViaEmail: false
    });
  }
);
