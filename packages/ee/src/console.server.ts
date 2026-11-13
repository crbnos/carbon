// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomInt } from "node:crypto";
import type { Database } from "@carbon/database";
import { readGrants } from "@carbon/database/access-write";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { CONSOLE_OPERATOR_GRANTS, consoleOperatorWork } from "./console-grants";
import { SUBJECT_RULES } from "./permission-grants";
import {
  type AccessWriteError,
  subjectEntitlement,
  writeAccessGrants
} from "./permissions.server";
import { companyHasFeature } from "./plan.server";

const logger = getLogger("ee", "console");

/**
 * RUNTIME gate for console (kiosk) mode — the DEGRADE counterpart of the
 * entitlement lock (`subjectEntitlement`) in `updateConsoleSetting`. Console
 * mode is on for a company only when BOTH its `companySettings.consoleEnabled`
 * flag is set AND the company is entitled to role authoring's feature
 * (`SUBJECT_RULES.role.feature`, the one the lock reads).
 *
 * The flag alone is not enough: it outlives the entitlement (a plan downgrade
 * leaves it set), and it predates the trigger that now keeps API roles from
 * writing it. Every MES path that enters or honours console mode must ask this
 * instead of reading the flag.
 *
 * `true` / `false` are definite answers. `null` means the settings row could
 * not be read: a caller that would ENTER console mode treats it as false
 * (`!result`), but one that would tear a live console session down must not —
 * a transient read error is not the company switching console mode off.
 *
 * Pass `consoleEnabled` when the caller already read the flag, to skip the read.
 */
export async function isConsoleModeEnabledForCompany(
  client: SupabaseClient<Database>,
  companyId: string,
  options: { consoleEnabled?: boolean } = {}
): Promise<boolean | null> {
  let consoleEnabled = options.consoleEnabled;
  if (consoleEnabled === undefined) {
    const settings = await client
      .from("companySettings")
      .select("consoleEnabled")
      .eq("id", companyId)
      .maybeSingle();

    if (settings.error) {
      logger.error("Failed to read console mode setting", {
        companyId,
        error: settings.error
      });
      return null;
    }
    consoleEnabled = settings.data?.consoleEnabled ?? false;
  }

  if (!consoleEnabled) return false;
  return companyHasFeature(client, companyId, {
    feature: SUBJECT_RULES.role.feature
  });
}

/**
 * Console PINs live in `employeePin` as a bcrypt hash (migration
 * `20260926141957_employee-pin`). That table has RLS on with no policies and no
 * API-role privileges, so it is reachable only over the server's direct Kysely
 * connection — never through a Supabase client, which is why these take `db`.
 * The plaintext PIN exists only in the request that creates it: it is
 * generated here, on the server, and shown to the admin once.
 */
export function generateConsolePin(): string {
  return randomInt(0, 10000).toString().padStart(4, "0");
}

export async function setEmployeePin(
  db: Kysely<KyselyDatabase>,
  {
    employeeId,
    companyId,
    pin,
    updatedBy
  }: {
    employeeId: string;
    companyId: string;
    pin: string;
    updatedBy: string;
  }
): Promise<void> {
  await sql`SELECT set_employee_pin(${employeeId}, ${companyId}, ${pin}, ${updatedBy})`.execute(
    db
  );
}

/**
 * `hasPin` is false when the employee has no PIN at all; `valid` is false for
 * a wrong PIN and for no PIN alike. Without a `pin` only `hasPin` is asked.
 */
export async function verifyEmployeePin(
  db: Kysely<KyselyDatabase>,
  {
    employeeId,
    companyId,
    pin
  }: { employeeId: string; companyId: string; pin?: string }
): Promise<{ hasPin: boolean; valid: boolean }> {
  const result = await sql<{ hasPin: boolean; valid: boolean }>`
    SELECT
      EXISTS (
        SELECT 1 FROM "employeePin"
        WHERE "employeeId" = ${employeeId} AND "companyId" = ${companyId}
      ) AS "hasPin",
      ${
        pin === undefined
          ? sql`false`
          : sql`verify_employee_pin(${employeeId}, ${companyId}, ${pin})`
      } AS "valid"
  `.execute(db);
  const row = result.rows[0];
  return { hasPin: row?.hasPin === true, valid: row?.valid === true };
}

/**
 * Commercial (Enterprise) console / kiosk mode. Enabling it provisions the
 * protected "Console Operator" employee type (MES-only permissions) and a PIN
 * for the enabling user — role provisioning, gated to the Business plan via the
 * role-authoring feature (`SUBJECT_RULES.role.feature`): a company without it gets an `entitlement` error
 * (`subjectEntitlement`), returned, not thrown.
 *
 * `companySettings.consoleEnabled` is written over `db` (the server's direct
 * connection): a DB trigger refuses changes to it from the API roles, so the
 * flag can only move through this function and its entitlement lock.
 *
 * `actorId` writes and audits the Console Operator grants. `pinUserId` is the
 * signed-in user who gets a PIN; a key caller passes none. Returns the PIN it
 * generated for `pinUserId` (only when that user had none) so the caller can
 * show it ONCE — it cannot be read back later. `pinError` is set when that PIN
 * could not be created; console mode is enabled regardless.
 */
export async function updateConsoleSetting(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    consoleEnabled,
    actorId,
    pinUserId: userId
  }: {
    companyId: string;
    consoleEnabled: boolean;
    actorId: string;
    pinUserId?: string;
  }
): Promise<{
  error: AccessWriteError | null;
  pin: string | null;
  pinError: string | null;
}> {
  const unentitled = await subjectEntitlement(client, companyId, "role");
  if (unentitled) return { error: unentitled, pin: null, pinError: null };

  if (consoleEnabled) {
    const provisioned = await provisionConsoleOperator(
      client,
      db,
      companyId,
      actorId
    );
    if (provisioned.error) {
      return { error: provisioned.error, pin: null, pinError: null };
    }
  }

  try {
    await db
      .updateTable("companySettings")
      .set({ consoleEnabled })
      .where("id", "=", companyId)
      .execute();
  } catch (err) {
    return {
      error: {
        code: "internal",
        message: "Failed to update console mode",
        cause: err
      },
      pin: null,
      pinError: null
    };
  }

  let generatedPin: string | null = null;
  let pinError: string | null = null;

  // A user with no employee row in this company fails the FK and gets no PIN.
  if (
    consoleEnabled &&
    userId &&
    !(await verifyEmployeePin(db, { employeeId: userId, companyId })).hasPin
  ) {
    const pin = generateConsolePin();
    try {
      await setEmployeePin(db, {
        employeeId: userId,
        companyId,
        pin,
        updatedBy: userId
      });
      generatedPin = pin;
    } catch (err) {
      logger.error("Failed to generate a console PIN for the enabling user", {
        companyId,
        userId,
        error: err
      });
      pinError = "A PIN could not be generated for you";
    }
  }

  return { error: null, pin: generatedPin, pinError };
}

/**
 * The protected "Console Operator" type and its grants (`CONSOLE_OPERATOR_GRANTS`),
 * in one transaction (`writeAccessGrants`): the type is created with its grants or
 * not at all. Users → Employee Types owns `employeeType`; this writes it over `db`
 * (the system), after the caller's people-settings permission and the entitlement,
 * for this company only.
 */
async function provisionConsoleOperator(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  actorId: string
): Promise<{ error: AccessWriteError | null }> {
  let existing: { id: string; grantCount: number } | undefined;
  try {
    const type = await db
      .selectFrom("employeeType")
      .select("id")
      .where("companyId", "=", companyId)
      .where("systemType", "=", "Console Operator")
      .executeTakeFirst();
    existing = type && {
      id: type.id,
      grantCount: (await readGrants(db, companyId, { employeeTypeId: type.id }))
        .length
    };
  } catch (err) {
    return {
      error: {
        code: "internal",
        message: "Failed to read the Console Operator type",
        cause: err
      }
    };
  }

  const work = consoleOperatorWork(existing);
  if (!work) return { error: null };
  const id = existing?.id ?? crypto.randomUUID();
  return writeAccessGrants(client, db, {
    companyId,
    subject: { employeeTypeId: id },
    change: { set: CONSOLE_OPERATOR_GRANTS },
    actorId,
    subjectRow:
      work === "create"
        ? (tx) =>
            tx
              .insertInto("employeeType")
              .values({
                id,
                name: "Console Operator",
                companyId,
                protected: true,
                systemType: "Console Operator"
              })
              .execute()
        : undefined
  });
}
