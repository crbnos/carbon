// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import {
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { KyselyMasterDataProvider } from "./master-data-provider.ts";

describe("per-id cached availability", () => {
  // Every read fails, as a dropped connection would.
  class FailingDriver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async () => {
          throw new Error("connection lost");
        },
        // biome-ignore lint/correctness/useYield: never streamed
        streamQuery: async function* () {
          throw new Error("not streamed");
        }
      };
    }
  }

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it.each(["getEmployeeAvailability", "getWorkCenterAvailability"] as const)(
    "%s rejects once when the read fails for several uncached ids, leaving no rejection unobserved",
    async (method) => {
      process.on("unhandledRejection", onUnhandled);
      const db = new Kysely<DB>({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => new FailingDriver(),
          createIntrospector: (k) => new PostgresIntrospector(k),
          createQueryCompiler: () => new PostgresQueryCompiler()
        }
      });
      const provider = new KyselyMasterDataProvider(db, {} as never, "co", {
        cacheCompanyData: true
      });

      await expect(
        provider[method](["id-1", "id-2"], 0, 3_600_000)
      ).rejects.toThrow("connection lost");
      // Node reports an unobserved rejection once the microtask queue drains.
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
    }
  );
});
