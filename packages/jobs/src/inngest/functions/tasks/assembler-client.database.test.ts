// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The model source lookup against a live local database: a row only ever
// reads a file under its own company. Skipped without a local SUPABASE_DB_URL.

import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobDatabaseClient } from "../../../db";
import { resolveModelSourceBucket } from "./assembler-client";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const hasLocalDatabase = (() => {
  try {
    return LOCAL_HOSTS.includes(
      new URL(process.env.SUPABASE_DB_URL ?? "").hostname
    );
  } catch {
    return false;
  }
})();

describe.skipIf(!hasLocalDatabase)("resolveModelSourceBucket", () => {
  const run = crypto.randomUUID().slice(0, 8);
  const owner = `t-${run}-owner`;
  const path = `${owner}/models/${run}.step`;

  beforeAll(async () => {
    await sql`INSERT INTO storage.objects (bucket_id, name) VALUES (${TEMP_STAGING_BUCKET}, ${path})`.execute(
      getJobDatabaseClient()
    );
  });

  afterAll(async () => {
    await getJobDatabaseClient()
      .transaction()
      .execute(async (trx) => {
        await sql`SET LOCAL storage.allow_delete_query = 'true'`.execute(trx);
        await sql`DELETE FROM storage.objects WHERE bucket_id = ${TEMP_STAGING_BUCKET} AND name = ${path}`.execute(
          trx
        );
      });
  });

  it("finds a staged file for the company that owns it", async () => {
    expect(await resolveModelSourceBucket(owner, path)).toBe(
      TEMP_STAGING_BUCKET
    );
  });

  it("never finds it for a row in another company", async () => {
    expect(await resolveModelSourceBucket(`t-${run}-other`, path)).toBeNull();
    expect(
      await resolveModelSourceBucket(
        `t-${run}-other`,
        `t-${run}-other/../${path}`
      )
    ).toBeNull();
  });
});
