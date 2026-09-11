import type { Database } from "@carbon/database";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: () => null,
  lookupEntry: () => null,
  hasEntry: () => false,
  termSlug: (value: string) => value,
  glossaryEntries: () => []
}));
vi.mock("~/modules/purchasing", () => ({}));
vi.mock("../people/people.service", () => ({}));
vi.mock("../sales/sales.service", () => ({}));
vi.mock("../accounting/accounting.ee.service", () => ({}));

import { getCardTransaction } from "./invoicing.service";

describe("getCardTransaction", () => {
  it("scopes the card transaction and embedded lines by company and id", async () => {
    const requests: URL[] = [];
    const client = createClient<Database>(
      "http://card-transaction.test",
      "key",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async (input) => {
            requests.push(new URL(String(input)));
            return Response.json({
              id: "shared-id",
              companyId: "company-a",
              cardTransactionLine: []
            });
          }
        }
      }
    );

    await getCardTransaction(client, "company-a", "shared-id");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("id")).toBe("eq.shared-id");
    expect(requests[0]?.searchParams.get("companyId")).toBe("eq.company-a");
  });
});
