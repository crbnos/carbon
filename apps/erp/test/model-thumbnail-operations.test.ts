// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Drawing a model's thumbnail again is open to every employee, but clearing a
// part's own thumbnail so the render shows is a part edit. Runs against the
// local stack (SUPABASE_DB_URL and the PostgREST `crbn up` started); skipped
// without one. Only the job queue is stubbed.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  connectLocalTestDatabase,
  hasLocalDatabase
} from "./database/fixtures/local-database";
import { localServiceRoleClient } from "./database/fixtures/local-supabase";

const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trigger
}));

import { regenerateModelThumbnail } from "../app/modules/documents/documents.server";

const client = hasLocalDatabase ? localServiceRoleClient() : null;
const describeLocal = describe.skipIf(!client);

const prefix = `thumb-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const ids = {
  company: `${prefix}-company`,
  group: `${prefix}-group`,
  model: `${prefix}-model`,
  part: `${prefix}-part`
};
const ownThumbnail = `${ids.company}/thumbnails/${ids.part}/own.png`;

type Db = Awaited<ReturnType<typeof connectLocalTestDatabase>>;
let db: Db;

function contextFor(partsUpdate: string[]) {
  return createServiceContext({
    actor: {
      type: "user",
      userId: "system",
      permissions: {
        parts: {
          view: [ids.company],
          create: [],
          update: partsUpdate,
          delete: []
        }
      }
    },
    company: { id: ids.company, groupId: ids.group },
    caller: client!,
    system: () => client!,
    pg: () => db,
    kv: () => {
      throw new Error("Not read here");
    }
  });
}

const setPartThumbnail = (thumbnailPath: string | null) =>
  db
    .updateTable("item")
    .set({ thumbnailPath })
    .where("id", "=", ids.part)
    .where("companyId", "=", ids.company)
    .execute();

const partThumbnail = async () =>
  (
    await db
      .selectFrom("item")
      .select("thumbnailPath")
      .where("id", "=", ids.part)
      .executeTakeFirstOrThrow()
  ).thumbnailPath;

beforeAll(async () => {
  if (!client) return;
  db = await connectLocalTestDatabase();
  const createdBy = "system";
  const companyId = ids.company;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: ids.group, name: prefix, createdBy })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: ids.group,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("unitOfMeasure")
      .values({ code: "EA", name: "Each", companyId, createdBy })
      .execute();
    await trx
      .insertInto("modelUpload")
      .values({
        id: ids.model,
        modelPath: `${companyId}/models/${ids.model}.step`,
        companyId,
        createdBy
      })
      .execute();
    await trx
      .insertInto("item")
      .values({
        id: ids.part,
        readableId: `${prefix}-PART`,
        name: "Bracket",
        type: "Part",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        modelUploadId: ids.model,
        companyId,
        createdBy
      })
      .execute();
  });
});

afterAll(async () => {
  if (!client) return;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx.deleteFrom("company").where("id", "=", ids.company).execute();
    await trx.deleteFrom("companyGroup").where("id", "=", ids.group).execute();
    await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${ids.company}`)}`.execute(
      trx
    );
    await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${ids.company}`)}`.execute(
      trx
    );
  });
  await db.destroy();
}, 60_000);

beforeEach(() => {
  trigger.mockReset();
  trigger.mockResolvedValue(undefined);
});

describeLocal("regenerateModelThumbnail", () => {
  it("refuses to replace a part's own thumbnail without parts update", async () => {
    await setPartThumbnail(ownThumbnail);

    const result = await regenerateModelThumbnail(contextFor([]), {
      modelUploadId: ids.model
    });

    expect(result.error?.category).toBe("forbidden");
    expect(await partThumbnail()).toBe(ownThumbnail);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("clears the part's thumbnail and draws the model's with parts update", async () => {
    await setPartThumbnail(ownThumbnail);

    const result = await regenerateModelThumbnail(contextFor([ids.company]), {
      modelUploadId: ids.model
    });

    expect(result.error).toBeNull();
    expect(await partThumbnail()).toBeNull();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("draws the model's thumbnail for any employee when no part has its own", async () => {
    await setPartThumbnail(null);

    const result = await regenerateModelThumbnail(contextFor([]), {
      modelUploadId: ids.model
    });

    expect(result.error).toBeNull();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("refuses a model of another company", async () => {
    const result = await regenerateModelThumbnail(contextFor([ids.company]), {
      modelUploadId: `${prefix}-elsewhere`
    });

    expect(result.error?.category).toBe("notFound");
    expect(trigger).not.toHaveBeenCalled();
  });
});
