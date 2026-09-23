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
vi.mock("../accounting/accounting.service", () => ({}));

import { getCharge } from "./invoicing.service";

describe("getCharge", () => {
  it("scopes the charge and embedded lines by company and id", async () => {
    const requests: URL[] = [];
    const client = createClient<Database>("http://charge.test", "key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          requests.push(new URL(String(input)));
          return Response.json({
            id: "shared-id",
            companyId: "company-a",
            chargeLine: []
          });
        }
      }
    });

    await getCharge(client, "company-a", "shared-id");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("id")).toBe("eq.shared-id");
    expect(requests[0]?.searchParams.get("companyId")).toBe("eq.company-a");
  });
});
