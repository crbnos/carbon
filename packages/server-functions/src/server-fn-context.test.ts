import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { createClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { authorize, clientUsesKey, ServerFnContext } from "./server-fn-context";

const fields = {
  db: {} as Kysely<KyselyDatabase>,
  companyId: "co1",
  userId: "u1"
};

describe("authorize", () => {
  it("lets the system through without reading claims", async () => {
    await expect(
      authorize(ServerFnContext.system(fields), { update: "inventory" })
    ).resolves.toBeUndefined();
  });

  it("refuses a user a system-only function", async () => {
    await expect(
      authorize(ServerFnContext.user(fields), "system")
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("clientUsesKey", () => {
  const client = (key: string) =>
    createClient<Database>("http://localhost:54321", key);

  it("recognizes the key a client was built with", () => {
    expect(clientUsesKey(client("service-role-key"), "service-role-key")).toBe(
      true
    );
  });

  it("does not mistake another key (a user's or API key's client) for it", () => {
    expect(clientUsesKey(client("anon-key"), "service-role-key")).toBe(false);
  });

  it("never matches an unset key", () => {
    expect(clientUsesKey(client("anon-key"), undefined)).toBe(false);
  });
});
