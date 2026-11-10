// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { randomInt } from "node:crypto";
import type { Database } from "@carbon/database";
import { type GrantInput, replaceGrants } from "@carbon/database/access-write";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { requireEntitlement } from "./entitlements.server";
import { companyHasFeature } from "./plan.server";

const logger = getLogger("ee", "console");

/**
 * RUNTIME gate for console (kiosk) mode — the DEGRADE counterpart of the
 * `requireEntitlement` lock in `updateConsoleSetting`. Console mode is on for a
 * company only when BOTH its `companySettings.consoleEnabled` flag is set AND the
 * company is entitled to the `PERMISSIONS` feature.
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
  return companyHasFeature(client, companyId, { feature: "PERMISSIONS" });
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
 * What a new Console Operator type may do: the MES modules only, never ERP
 * administration. Module grants, so every page of a module (the MES gates on
 * `production.jobs`, `production.batches`, `quality.inspections`,
 * `quality.issues`) is covered. Edit is view, create and update without delete
 * — the checkboxes this type was created with before grants.
 */
export const CONSOLE_OPERATOR_GRANTS: readonly GrantInput[] = [
  { module: "Production", page: null, level: "Edit" },
  { module: "Inventory", page: null, level: "Edit" },
  { module: "Quality", page: null, level: "Edit" },
  { module: "Resources", page: null, level: "View" },
  { module: "Items", page: null, level: "View" },
  { module: "People", page: null, level: "View" }
];

/**
 * Commercial (Enterprise) console / kiosk mode. Enabling it provisions the
 * protected "Console Operator" employee type (MES-only permissions) and a PIN
 * for the enabling user — role provisioning, gated to the Business plan via the
 * `PERMISSIONS` feature. The console settings route
 * (`apps/erp/.../x+/settings+/people.tsx`) blocks this for Community/Starter
 * before calling it; the `.server` file is server-only and the `@carbon/ee`
 * package boundary carries the commercial license (see root LICENSE).
 *
 * `companySettings.consoleEnabled` is written over `db` (the server's direct
 * connection): a DB trigger refuses changes to it from the API roles, so the
 * flag can only move through this function and its entitlement lock.
 *
 * Returns the PIN it generated for `userId` (only when that user had none) so
 * the caller can show it ONCE — it cannot be read back later. `pinError` is
 * set when that PIN could not be created; console mode is enabled regardless.
 */
export async function updateConsoleSetting(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  consoleEnabled: boolean,
  userId?: string
): Promise<{
  error: { message: string } | null;
  pin: string | null;
  pinError: string | null;
}> {
  await requireEntitlement(client, companyId, "PERMISSIONS");

  try {
    await db
      .updateTable("companySettings")
      .set({ consoleEnabled })
      .where("id", "=", companyId)
      .execute();
  } catch (err) {
    return {
      error: {
        message:
          err instanceof Error ? err.message : "Failed to update console mode"
      },
      pin: null,
      pinError: null
    };
  }

  let generatedPin: string | null = null;
  let pinError: string | null = null;

  // When enabling, create "Console Operator" employee type if it doesn't exist.
  // Users → Employee Types owns `employeeType`: written over `db` (the system), after
  // the caller's people-settings permission and the entitlement above, for
  // this company only — as the grants are.
  if (consoleEnabled) {
    let employeeTypeId: string | undefined;
    try {
      const existing = await db
        .selectFrom("employeeType")
        .select("id")
        .where("companyId", "=", companyId)
        .where("systemType", "=", "Console Operator")
        .executeTakeFirst();

      if (!existing) {
        const created = await db
          .insertInto("employeeType")
          .values({
            name: "Console Operator",
            companyId,
            protected: true,
            systemType: "Console Operator"
          })
          .returning("id")
          .executeTakeFirst();
        employeeTypeId = created?.id;
      }
    } catch (err) {
      logger.error("Failed to create the Console Operator type", {
        companyId,
        error: err
      });
    }

    if (employeeTypeId) {
      try {
        await replaceGrants(db, {
          companyId,
          subject: { employeeTypeId },
          grants: CONSOLE_OPERATOR_GRANTS,
          userId: userId ?? "system"
        });
      } catch (err) {
        logger.error("Failed to grant the Console Operator type access", {
          companyId,
          employeeTypeId,
          error: err
        });
      }
    }

    // Auto-generate a PIN for the enabling user if they don't have one
    // (a user with no employee row in this company fails the FK and gets none,
    // as before).
    if (
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
        // Console mode is on either way; the enabling user just has no PIN
        // yet (e.g. no employee row in this company) and needs one reset.
        logger.error("Failed to generate a console PIN for the enabling user", {
          companyId,
          userId,
          error: err
        });
        pinError = "A PIN could not be generated for you";
      }
    }
  }

  return { error: null, pin: generatedPin, pinError };
}
