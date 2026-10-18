// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL) and the local stack's
// PostgREST; skipped without them.

// A new make method version is a header insert plus get-method's copy, and the
// copy runs in its own transaction. These pin what `upsertMakeMethodVersion`
// guarantees around it: a step slide's pins are copied as JSON (a raw array
// was sent as a Postgres array literal, failed the copy and left an empty
// version), a failed copy leaves no version behind, and only a source this call
// set Active is set back to Draft. The copy failures are real: the anonymous
// client is refused by get-method's own permission check.

import { SUPABASE_SERVICE_ROLE_KEY } from "@carbon/env";
import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { upsertMakeMethodVersion } from "../../app/modules/items/items.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";
import {
  localAnonClient,
  localServiceRoleClient
} from "./fixtures/local-supabase";

// The header and the source's status go through the local PostgREST.
const system = hasLocalDatabase ? localServiceRoleClient() : null;
// The copy as the system: get-method checks its caller by the configured key
// and copies through the database, so this client never sends a request.
const copyAsSystem = createClient(
  "http://localhost:54321",
  SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async () => {
        throw new Error("The copy sends no service-role request");
      }) as typeof fetch
    }
  }
);
// A caller with no permissions: get-method refuses it, a real copy failure.
const refused = hasLocalDatabase ? localAnonClient() : null;

const PINS = [
  { id: "pin-1", x: 0.25, y: 0.5, color: "#ef4444" },
  { id: "pin-2", x: 0.7, y: 0.75, color: "#ef4444", label: "Torque" }
];

const versionTest = (name: string, fn: (f: Fixture) => Promise<void>) =>
  databaseTest(name, async () => {
    if (!system || !refused) return;
    const f = await alwaysPostFixture();
    try {
      await fn(f);
    } finally {
      await f.cleanup();
    }
  });

/** The assembly's only make method (made by its item insert), set to
 *  `status`, with one material and one operation whose step has one slide. */
async function sourceMethod(
  f: Fixture,
  status: "Draft" | "Active",
  annotations: unknown
) {
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
        annotations: JSON.stringify(annotations),
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

const version = (f: Fixture, copyFromId: string, activeVersionId?: string) => ({
  copyFromId,
  activeVersionId,
  version: 2,
  companyId: f.companyId,
  createdBy: USER
});

versionTest("copies the source and its pinned slide, and sets a Draft source Active", async (f) => {
  const source = await sourceMethod(f, "Draft", PINS);

  const result = await upsertMakeMethodVersion(
    system!,
    f.db,
    version(f, source, source),
    copyAsSystem
  );

  expect(result.error).toBeNull();
  const draftId = result.data!.id;
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" },
    { id: draftId, version: 2, status: "Draft" }
  ]);
  expect(await copied(f, draftId)).toEqual({
    materials: 1,
    annotations: [PINS]
  });
});

versionTest("copies a slide stored as {} as one with no pins", async (f) => {
  const source = await sourceMethod(f, "Draft", {});

  const result = await upsertMakeMethodVersion(
    system!,
    f.db,
    version(f, source),
    copyAsSystem
  );

  expect(result.error).toBeNull();
  expect((await copied(f, result.data!.id)).annotations).toEqual([[]]);
});

versionTest("leaves a source that was already Active Active when the copy fails", async (f) => {
  const source = await sourceMethod(f, "Active", PINS);

  const result = await upsertMakeMethodVersion(
    system!,
    f.db,
    version(f, source, source),
    refused!
  );

  expect(result.error).not.toBeNull();
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Active" }
  ]);
});

versionTest("deletes the new version and sets the Draft source back when the copy fails", async (f) => {
  const source = await sourceMethod(f, "Draft", PINS);

  const result = await upsertMakeMethodVersion(
    system!,
    f.db,
    version(f, source, source),
    refused!
  );

  expect(result.error?.message).toBeTruthy();
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
});

versionTest("refuses to set Active a version other than the one copied", async (f) => {
  const source = await sourceMethod(f, "Draft", PINS);

  const result = await upsertMakeMethodVersion(
    system!,
    f.db,
    version(f, source, `${f.prefix}-other`),
    copyAsSystem
  );

  expect(result.error).toMatchObject({ code: "CARBON_RULE" });
  expect(await versions(f)).toEqual([
    { id: source, version: 1, status: "Draft" }
  ]);
});
