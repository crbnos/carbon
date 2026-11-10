// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database and PostgREST; skipped without them. The
// copy runs as the system through the database, so a copy failure is made
// real with a trigger that refuses the step slide insert.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { sql } from "kysely";
import { expect, it } from "vitest";
import { createMethodVersion } from "../../app/modules/items/items.server";
import {
  createChangeNoticeDraftMethod,
  createMakeMethodVersion
} from "../../app/modules/items/items.service";
import { ensureDraftMakeMethod } from "../../app/modules/settings/settings.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import {
  localAnonClient,
  localServiceRoleClient
} from "./fixtures/local-supabase";

const system = hasLocalDatabase ? localServiceRoleClient() : null;
const refused = hasLocalDatabase ? localAnonClient() : null;

const PINS = [
  { id: "pin-1", x: 0.25, y: 0.5, color: "#ef4444" },
  { id: "pin-2", x: 0.7, y: 0.75, color: "#ef4444", label: "Torque" }
];

const versionTest = (name: string, fn: (f: Fixture) => Promise<void>) =>
  it.skipIf(!system || !refused)(
    name,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await fn(f);
      } finally {
        await f.cleanup();
      }
    },
    60_000
  );

async function sourceMethod(f: Fixture, status: "Draft" | "Active") {
  const method = await f.db
    .selectFrom("makeMethod")
    .select("id")
    .where("itemId", "=", f.assemblyId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const processId = `${f.prefix}-process`;
  await seed(f, async (trx) => {
    await trx
      .updateTable("makeMethod")
      .set({ status })
      .where("id", "=", method.id)
      .where("companyId", "=", f.companyId)
      .execute();
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: "Assemble",
        defaultStandardFactor: "Hours/Piece",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    const operation = await trx
      .insertInto("methodOperation")
      .values({
        makeMethodId: method.id,
        processId,
        description: "Assemble",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const step = await trx
      .insertInto("methodOperationStep")
      .values({
        operationId: operation.id,
        name: "Check the bracket",
        type: "Task",
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("methodOperationStepSlide")
      .values({
        stepId: step.id,
        imagePath: `${f.companyId}/step.png`,
        annotations: JSON.stringify(PINS),
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("methodMaterial")
      .values({
        makeMethodId: method.id,
        itemId: f.partId,
        itemType: "Part",
        quantity: 2,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return method.id;
}

async function versions(f: Fixture) {
  return f.db
    .selectFrom("makeMethod")
    .select(["id", "version", "status"])
    .where("itemId", "=", f.assemblyId)
    .where("companyId", "=", f.companyId)
    .orderBy("version")
    .execute();
}

async function copied(f: Fixture, makeMethodId: string) {
  const materials = await f.db
    .selectFrom("methodMaterial")
    .select("id")
    .where("makeMethodId", "=", makeMethodId)
    .where("companyId", "=", f.companyId)
    .execute();
  const slides = await f.db
    .selectFrom("methodOperationStepSlide as slide")
    .innerJoin("methodOperationStep as step", "step.id", "slide.stepId")
    .innerJoin("methodOperation as operation", "operation.id", "step.operationId")
    .select("slide.annotations")
    .where("operation.makeMethodId", "=", makeMethodId)
    .where("slide.companyId", "=", f.companyId)
    .execute();
  return {
    materials: materials.length,
    annotations: slides.map((slide) => slide.annotations)
  };
}

// Every line in the company, on any method: rolled-back copies leave none.
async function companyLines(f: Fixture) {
  const count = async (
    table: "methodMaterial" | "methodOperation" | "methodOperationStep"
  ) =>
    (
      await f.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow()
    ).count;
  return {
    materials: Number(await count("methodMaterial")),
    operations: Number(await count("methodOperation")),
    steps: Number(await count("methodOperationStep"))
  };
}

// The operation and its step are copied before the slide, so a refused slide
// insert fails the copy after it has written rows into the new version.
async function withFailingSlideCopy(f: Fixture, fn: () => Promise<void>) {
  const name = `fail_slide_copy_${f.prefix.replace(/[^a-z0-9]/gi, "_")}`;
  await sql
    .raw(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'slide copy refused'; END $$`
    )
    .execute(f.db);
  await sql
    .raw(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON "methodOperationStepSlide" FOR EACH ROW WHEN (NEW."companyId" = '${f.companyId}') EXECUTE FUNCTION "${name}"()`
    )
    .execute(f.db);
  try {
    await fn();
  } finally {
    await sql
      .raw(`DROP TRIGGER "${name}" ON "methodOperationStepSlide"`)
      .execute(f.db);
    await sql.raw(`DROP FUNCTION "${name}"()`).execute(f.db);
  }
}

const version = (
  f: Fixture,
  copyFromId: string,
  options: { activate?: boolean; changeOrderId?: string } = {}
) => ({
  copyFromId,
  version: 2,
  ...options,
  companyId: f.companyId,
  createdBy: USER
});

versionTest("copies the source and sets a Draft source Active", async (f) => {
  const source = await sourceMethod(f, "Draft");

  const result = await createMakeMethodVersion(
    system!,
    f.db,
    version(f, source, { activate: true })
  );

  expect(result.error).toBeNull();
  const draftId = result.data!.id;
  expect(result.data).toMatchObject({ itemId: f.assemblyId, type: "Part" });
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" },
    { id: draftId, version: 2, status: "Draft" }
  ]);
  expect(await copied(f, draftId)).toEqual({
    materials: 1,
    annotations: [PINS]
  });
});

versionTest("rolls back the version, the activation and the copied lines when the copy fails", async (f) => {
  const source = await sourceMethod(f, "Draft");
  const before = await companyLines(f);

  await withFailingSlideCopy(f, async () => {
    const result = await createMakeMethodVersion(
      system!,
      f.db,
      version(f, source, { activate: true })
    );
    expect(result.error).not.toBeNull();
  });

  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
  expect(await companyLines(f)).toEqual(before);
});

versionTest("leaves an Active source Active when the copy fails", async (f) => {
  const source = await sourceMethod(f, "Active");

  await withFailingSlideCopy(f, async () => {
    const result = await createMakeMethodVersion(
      system!,
      f.db,
      version(f, source, { activate: true })
    );
    expect(result.error).not.toBeNull();
  });

  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" }
  ]);
});

versionTest("writes the change notice on the new Draft in the same insert", async (f) => {
  const source = await sourceMethod(f, "Active");
  const changeNotice = await f.db
    .insertInto("changeOrder")
    .values({
      changeOrderId: `${f.prefix}-CN`,
      name: "Swap the bracket",
      openDate: "2026-10-22",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const result = await createMakeMethodVersion(
    system!,
    f.db,
    version(f, source, { changeOrderId: changeNotice.id })
  );

  expect(result.error).toBeNull();
  const draft = await f.db
    .selectFrom("makeMethod")
    .select(["status", "changeOrderId"])
    .where("id", "=", result.data!.id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  expect(draft).toEqual({ status: "Draft", changeOrderId: changeNotice.id });
});

versionTest("joins a transaction it is handed, and rolls back with it", async (f) => {
  const source = await sourceMethod(f, "Draft");
  const before = await companyLines(f);

  await expect(
    f.db.transaction().execute(async (trx) => {
      const result = await createMakeMethodVersion(
        system!,
        trx,
        version(f, source, { activate: true })
      );
      expect(result.error).toBeNull();
      throw new Error("the caller's later write failed");
    })
  ).rejects.toThrow("the caller's later write failed");

  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
  expect(await companyLines(f)).toEqual(before);
});

versionTest("writes nothing for a caller who cannot read the version", async (f) => {
  const source = await sourceMethod(f, "Draft");

  const result = await createMakeMethodVersion(
    refused!,
    f.db,
    version(f, source, { activate: true })
  );

  expect(result.error).not.toBeNull();
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
});

/** The operation's context, as the system on behalf of the test user. */
function contextOf(f: Fixture) {
  return createServiceContext({
    actor: { type: "system", onBehalfOf: USER },
    company: { id: f.companyId, groupId: f.groupId },
    caller: system!,
    system: () => system!,
    pg: () => f.db,
    kv: () => {
      throw new Error("Creating a version reads no cache");
    }
  });
}

versionTest("refuses to set Active a version other than the one copied", async (f) => {
  const source = await sourceMethod(f, "Draft");

  const result = await createMethodVersion(contextOf(f), {
    copyFromId: source,
    activeVersionId: `${f.prefix}-other`,
    version: 2
  });

  expect(result.error?.category).toBe("rule");
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
});

versionTest("reports a failed copy as internal", async (f) => {
  const source = await sourceMethod(f, "Draft");

  await withFailingSlideCopy(f, async () => {
    const result = await createMethodVersion(contextOf(f), {
      copyFromId: source,
      activeVersionId: source,
      version: 2
    });
    expect(result.error).toMatchObject({
      category: "internal",
      message: "Failed to create new version"
    });
  });

  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
});

async function changeNotice(f: Fixture) {
  return f.db
    .insertInto("changeOrder")
    .values({
      changeOrderId: `${f.prefix}-CN-${crypto.randomUUID().slice(0, 8)}`,
      name: "Swap the bracket",
      openDate: "2026-10-22",
      companyId: f.companyId,
      createdBy: USER
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

versionTest("a Version change notice activates a Draft base and owns its new Draft", async (f) => {
  const source = await sourceMethod(f, "Draft");
  const notice = await changeNotice(f);

  const result = await createChangeNoticeDraftMethod(system!, f.db, {
    changeNoticeId: notice.id,
    itemId: f.assemblyId,
    changeType: "Version",
    companyId: f.companyId,
    userId: USER
  });

  expect(result.error).toBeNull();
  const draftId = result.data!.draftMakeMethodId!;
  expect(result.data).toMatchObject({ baseMakeMethodId: source });
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" },
    { id: draftId, version: 2, status: "Draft" }
  ]);
  const draft = await f.db
    .selectFrom("makeMethod")
    .select("changeOrderId")
    .where("id", "=", draftId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  expect(draft.changeOrderId).toBe(notice.id);
  expect(await copied(f, draftId)).toEqual({
    materials: 1,
    annotations: [PINS]
  });
});

versionTest("a failed copy leaves a Version change notice no Draft and the base a Draft", async (f) => {
  const source = await sourceMethod(f, "Draft");
  const notice = await changeNotice(f);

  await withFailingSlideCopy(f, async () => {
    const result = await createChangeNoticeDraftMethod(system!, f.db, {
      changeNoticeId: notice.id,
      itemId: f.assemblyId,
      changeType: "Version",
      companyId: f.companyId,
      userId: USER
    });
    expect(result.error).not.toBeNull();
  });

  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
});

// The source's one line, owned by an earlier Onshape push. Line ownership rows
// carry no externalId, as `insertOwnedMethodLines` writes them.
async function ownSourceLine(f: Fixture, sourceId: string) {
  const line = await f.db
    .selectFrom("methodMaterial")
    .select("id")
    .where("makeMethodId", "=", sourceId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  await f.db
    .insertInto("externalIntegrationMapping")
    .values({
      entityType: "methodMaterial",
      entityId: line.id,
      integration: ONSHAPE_V2,
      metadata: JSON.stringify({ makeMethodId: sourceId }),
      companyId: f.companyId,
      createdBy: USER
    })
    .execute();
}

const ONSHAPE_V2 = "onshape-v2";

async function onshapeMappings(f: Fixture) {
  return f.db
    .selectFrom("externalIntegrationMapping")
    .select(["entityType", "entityId", "metadata"])
    .where("companyId", "=", f.companyId)
    .where("integration", "=", ONSHAPE_V2)
    .orderBy("entityType")
    .orderBy("createdAt")
    .execute();
}

versionTest("the Onshape Draft carries line ownership and its marker with the copy", async (f) => {
  const source = await sourceMethod(f, "Active");
  await ownSourceLine(f, source);

  const result = await ensureDraftMakeMethod(system!, f.db, {
    itemId: f.assemblyId,
    activeMethodId: source,
    companyId: f.companyId,
    userId: USER,
    reusableDraft: null
  });

  expect(result).toMatchObject({ ok: true, created: true, version: 2 });
  const draftId = (result as { id: string }).id;
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" },
    { id: draftId, version: 2, status: "Draft" }
  ]);
  const copiedLine = await f.db
    .selectFrom("methodMaterial")
    .select("id")
    .where("makeMethodId", "=", draftId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const mappings = await onshapeMappings(f);
  expect(mappings).toHaveLength(3);
  expect(mappings).toEqual(
    expect.arrayContaining([
      {
        entityType: "makeMethod",
        entityId: draftId,
        metadata: { sourceMethodId: source, itemId: f.assemblyId }
      },
      {
        entityType: "methodMaterial",
        entityId: copiedLine.id,
        metadata: { makeMethodId: draftId }
      }
    ])
  );
});

versionTest("the Onshape Draft leaves nothing behind when its marker cannot be written", async (f) => {
  const source = await sourceMethod(f, "Active");
  await ownSourceLine(f, source);
  const before = { lines: await companyLines(f), mappings: await onshapeMappings(f) };

  const name = `fail_marker_${f.prefix.replace(/[^a-z0-9]/gi, "_")}`;
  await sql
    .raw(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marker refused'; END $$`
    )
    .execute(f.db);
  await sql
    .raw(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON "externalIntegrationMapping" FOR EACH ROW WHEN (NEW."companyId" = '${f.companyId}' AND NEW."entityType" = 'makeMethod') EXECUTE FUNCTION "${name}"()`
    )
    .execute(f.db);
  try {
    const result = await ensureDraftMakeMethod(system!, f.db, {
      itemId: f.assemblyId,
      activeMethodId: source,
      companyId: f.companyId,
      userId: USER,
      reusableDraft: null
    });
    expect(result).toMatchObject({ ok: false });
  } finally {
    await sql
      .raw(`DROP TRIGGER "${name}" ON "externalIntegrationMapping"`)
      .execute(f.db);
    await sql.raw(`DROP FUNCTION "${name}"()`).execute(f.db);
  }

  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" }
  ]);
  expect({
    lines: await companyLines(f),
    mappings: await onshapeMappings(f)
  }).toEqual(before);
});
