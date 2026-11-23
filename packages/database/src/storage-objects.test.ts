// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KyselyDatabase } from "./client.ts";
import {
  findStorageObjectBuckets,
  listStorageObjects
} from "./storage-objects.ts";

// Runs against the local database:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- storage-objects
// Each test runs in one transaction that is rolled back.

const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)("findStorageObjectBuckets", () => {
  const client = new Client({ connectionString: url });
  const db = new Kysely<KyselyDatabase>({
    dialect: new PostgresDialect({
      pool: {
        connect: async () =>
          Object.assign(client, { release: () => undefined }),
        end: async () => undefined
      }
    })
  });
  const run = randomUUID().slice(0, 8);
  const company = `t-${run}-company`;
  const staging = `t-${run}-staging`;

  async function object(bucket: string, name: string) {
    await client.query(
      "INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2)",
      [bucket, name]
    );
  }

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  async function seed() {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO storage.buckets (id, name) VALUES ($1, $1), ($2, $2)",
      [company, staging]
    );
  }

  it("prefers the first bucket that holds the object", async () => {
    await seed();
    await object(company, `${company}/models/a.step`);
    await object(staging, `${company}/models/a.step`);
    await object(staging, `${company}/models/b.step`);

    const found = await findStorageObjectBuckets(db, {
      names: [
        `${company}/models/a.step`,
        `${company}/models/b.step`,
        `${company}/models/missing.step`
      ],
      buckets: [company, staging]
    });

    expect(Object.fromEntries(found)).toEqual({
      [`${company}/models/a.step`]: company,
      [`${company}/models/b.step`]: staging
    });
  });

  it("never answers with a bucket it was not asked about", async () => {
    await seed();
    await object(staging, `${company}/models/a.step`);

    const found = await findStorageObjectBuckets(db, {
      names: [`${company}/models/a.step`],
      buckets: [company]
    });

    expect(found.size).toBe(0);
  });
});

describe.skipIf(!url)("listStorageObjects", () => {
  const client = new Client({ connectionString: url });
  const db = new Kysely<KyselyDatabase>({
    dialect: new PostgresDialect({
      pool: {
        connect: async () =>
          Object.assign(client, { release: () => undefined }),
        end: async () => undefined
      }
    })
  });
  const run = randomUUID().slice(0, 8);
  const bucket = `t-${run}-company`;
  const other = `t-${run}-other`;
  const folder = `${bucket}/parts/item_1`;

  async function object(bucketId: string, name: string, size?: number) {
    await client.query(
      "INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ($1, $2, $3)",
      [bucketId, name, size === undefined ? null : { size }]
    );
  }

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  afterAll(async () => {
    await client.end();
  });

  it("lists only the files directly inside each folder", async () => {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO storage.buckets (id, name) VALUES ($1, $1), ($2, $2)",
      [bucket, other]
    );
    await object(bucket, `${folder}/drawing.pdf`, 1200);
    await object(bucket, `${folder}/sub/nested.pdf`, 10);
    await object(bucket, `${folder}/.emptyFolderPlaceholder`, 0);
    // `_` is a LIKE wildcard: item_10 and itemX1 must not match item_1.
    await object(bucket, `${bucket}/parts/item_10/other.pdf`, 10);
    await object(bucket, `${bucket}/parts/itemX1/other.pdf`, 10);
    await object(other, `${folder}/elsewhere.pdf`, 10);

    expect(await listStorageObjects(db, { bucket, folders: [folder] })).toEqual(
      [
        {
          folder,
          name: "drawing.pdf",
          path: `${folder}/drawing.pdf`,
          size: 1200
        }
      ]
    );
  });

  it("reports an unknown size as null, not 0", async () => {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO storage.buckets (id, name) VALUES ($1, $1)",
      [bucket]
    );
    await object(bucket, `${folder}/model.step`);

    const [file] = await listStorageObjects(db, { bucket, folders: [folder] });
    expect(file?.size).toBeNull();
  });
});
