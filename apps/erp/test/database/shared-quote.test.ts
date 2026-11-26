// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The share link is the only credential, so
// what getSharedQuote returns is what anyone holding the link gets.

import { afterAll, beforeAll, expect } from "vitest";
import { getSharedQuote } from "../../app/modules/sales/sales.service";
import { alwaysPostFixture, type Fixture, seed, USER } from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

let f: Fixture;
let quoteId: string;
let linkId: string;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  quoteId = crypto.randomUUID();
  linkId = crypto.randomUUID();

  await seed(f, async (trx) => {
    await trx
      .insertInto("quote")
      .values({
        id: quoteId,
        quoteId: "Q-1",
        customerId: f.customerId,
        status: "Sent",
        currencyCode: "USD",
        exchangeRate: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("externalLink")
      .values({
        id: linkId,
        documentType: "Quote",
        documentId: quoteId,
        customerId: f.customerId,
        companyId: f.companyId
      })
      .execute();
    await trx
      .updateTable("quote")
      .set({ externalLinkId: linkId })
      .where("id", "=", quoteId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await f.cleanup();
}, 120_000);

async function setDigitalQuotes(enabled: boolean) {
  await f.db
    .updateTable("companySettings")
    .set({ digitalQuoteEnabled: enabled })
    .where("id", "=", f.companyId)
    .execute();
}

postgrestTest("opens the quote while Digital Quotes is on", async (client) => {
  await setDigitalQuotes(true);
  expect((await getSharedQuote(client, linkId))?.id).toBe(quoteId);
});

postgrestTest("opens nothing while Digital Quotes is off", async (client) => {
  await setDigitalQuotes(false);
  expect(await getSharedQuote(client, linkId)).toBeNull();
});

postgrestTest("opens nothing for a link that names no quote", async (client) => {
  await setDigitalQuotes(true);
  expect(await getSharedQuote(client, crypto.randomUUID())).toBeNull();
});
