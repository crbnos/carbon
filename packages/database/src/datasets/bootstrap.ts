import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import {
  accountDefaults,
  accounts,
  changeOrderRequiredActions,
  changeOrderTypes,
  currencies,
  customerStatuses,
  defaultLocation,
  dimensions,
  failureModes,
  fiscalYearSettings,
  fixedAssetClasses,
  gaugeTypes,
  getGroupId,
  groups,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  periodCloseTaskDefinitions,
  scrapReasons,
  sequences,
  unitOfMeasures
} from "../../supabase/functions/lib/seed.data.ts";
import type { Database } from "../types.ts";
import type { Resolved } from "./types.ts";

export const DEV_PASSWORD = "password";
export const DEV_COMPANY_NAME = "Carbon Development";

// Local part of the email, first segment, capitalized.
function inferFirstNameFromEmail(email: string): string {
  const localPart = email.split("@")[0]!;
  const firstName = localPart.split(/[.+_-]/)[0]!;
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

/**
 * Creates the auth user, the company, and every piece of reference data a
 * company needs. Runs only when --email resolves to no existing company, which
 * is what keeps `crbn up` working on a fresh worktree.
 */
export async function bootstrap(
  client: PoolClient,
  email: string
): Promise<Resolved> {
  const supabaseAdmin = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Supabase Auth calls cannot participate in the pg transaction.
  const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find((u) => u.email === email);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: DEV_PASSWORD
    });
    if (error) {
      console.warn(`   Warning: could not update password: ${error.message}`);
    }
  } else {
    const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: DEV_PASSWORD,
      email_confirm: true,
      app_metadata: {
        role: "employee",
        provider: "email",
        providers: ["email"]
      }
    });
    if (error) throw new Error(`Failed to create user: ${error.message}`);
    if (!newUser.user)
      throw new Error("Failed to create user: no user returned");
    userId = newUser.user.id;
  }

  const firstName = inferFirstNameFromEmail(email);
  await client.query(`UPDATE "user" SET "firstName" = $1 WHERE id = $2`, [
    firstName,
    userId
  ]);

  await client.query("BEGIN");
  try {
    const { companyId } = await seedCompanyReferenceData(client, {
      userId,
      companyName: DEV_COMPANY_NAME
    });
    // Dev/test convenience: enable accounting so posting flows create GL
    // journals out of the box. Production keeps the column default (false) —
    // this is the dev-seed bootstrap path only, not seedCompanyReferenceData,
    // which onboarding and the drift checker also run.
    await client.query(
      `UPDATE "companySettings" SET "accountingEnabled" = true WHERE id = $1`,
      [companyId]
    );
    await client.query("COMMIT");
    return { companyId, userId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Everything a brand-new company needs before the dataset tiers can run: the
 * company itself, its group, and all of its reference data.
 *
 * Owns NO transaction — the caller does. `bootstrap` commits it; the drift
 * checker (`datasets/verify.ts`) rolls it back, which is what lets that check
 * exercise the real insert path against a developer's own database.
 */
export async function seedCompanyReferenceData(
  client: PoolClient,
  args: { userId: string; companyName: string }
): Promise<{ companyId: string; companyGroupId: string; locationId: string }> {
  const { userId, companyName } = args;

  const xidResult = await client.query("SELECT xid() as id");
  const companyId = xidResult.rows[0].id as string;

  const companyGroupResult = await client.query(
    `INSERT INTO "companyGroup" (name, "createdBy") VALUES ($1, $2) RETURNING id`,
    [companyName, userId]
  );
  const companyGroupId = companyGroupResult.rows[0].id as string;

  await client.query(
    `INSERT INTO company (id, name, "baseCurrencyCode", "companyGroupId") VALUES ($1, $2, 'USD', $3)`,
    [companyId, companyName, companyGroupId]
  );

  await client.query(
    `INSERT INTO storage.buckets (id, name, public) VALUES ($1, $2, false)`,
    [companyId, companyId]
  );

  await client.query(
    `INSERT INTO "userToCompany" ("userId", "companyId", "role") VALUES ($1, $2, 'employee')`,
    [userId, companyId]
  );

  for (const group of groups) {
    await client.query(
      `INSERT INTO "group" (id, name, "isCustomerTypeGroup", "isEmployeeTypeGroup", "isSupplierTypeGroup", "companyId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        getGroupId(group.idPrefix, companyId),
        group.name,
        group.isCustomerTypeGroup,
        group.isEmployeeTypeGroup,
        group.isSupplierTypeGroup,
        companyId
      ]
    );
  }

  const employeeTypeResult = await client.query(
    `INSERT INTO "employeeType" (name, "companyId", protected, "systemType") VALUES ('Admin', $1, true, 'Admin') RETURNING id`,
    [companyId]
  );
  const employeeTypeId = employeeTypeResult.rows[0].id;

  const modulesResult = await client.query(`SELECT name FROM modules`);
  const modules = modulesResult.rows as { name: string }[];

  for (const module of modules) {
    if (!module.name) continue;
    await client.query(
      `INSERT INTO "employeeTypePermission" ("employeeTypeId", module, "create", "update", "delete", view)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        employeeTypeId,
        module.name,
        [companyId],
        [companyId],
        [companyId],
        [companyId]
      ]
    );
  }

  await client.query(
    `INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES ($1, $2, $3, true)`,
    [userId, employeeTypeId, companyId]
  );

  for (const name of customerStatuses) {
    await client.query(
      `INSERT INTO "customerStatus" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [name, companyId]
    );
  }

  for (const name of scrapReasons) {
    await client.query(
      `INSERT INTO "scrapReason" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [name, companyId]
    );
  }

  for (const pt of paymentTerms) {
    await client.query(
      `INSERT INTO "paymentTerm" (name, "daysDue", "calculationMethod", "daysDiscount", "discountPercentage", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, 'system')`,
      [
        pt.name,
        pt.daysDue,
        pt.calculationMethod,
        pt.daysDiscount,
        pt.discountPercentage,
        companyId
      ]
    );
  }

  for (const uom of unitOfMeasures) {
    await client.query(
      `INSERT INTO "unitOfMeasure" (name, code, "companyId", "createdBy") VALUES ($1, $2, $3, 'system')`,
      [uom.name, uom.code, companyId]
    );
  }

  for (const d of periodCloseTaskDefinitions) {
    await client.query(
      `INSERT INTO "periodCloseTaskDefinition" (name, "taskType", "autoCheckKey", "sortOrder", required, severity, active, "isSystem", "companyId", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'system')`,
      [
        d.name,
        d.taskType,
        d.autoCheckKey,
        d.sortOrder,
        d.required,
        d.severity,
        d.active,
        d.isSystem,
        companyId
      ]
    );
  }

  for (const gt of gaugeTypes) {
    await client.query(
      `INSERT INTO "gaugeType" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [gt, companyId]
    );
  }

  for (const fm of failureModes) {
    await client.query(
      `INSERT INTO "maintenanceFailureMode" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [fm, companyId]
    );
  }

  for (const nct of nonConformanceTypes) {
    await client.query(
      `INSERT INTO "nonConformanceType" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [nct.name, companyId]
    );
  }

  for (const cot of changeOrderTypes) {
    await client.query(
      `INSERT INTO "changeOrderType" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [cot.name, companyId]
    );
  }

  for (const nca of nonConformanceRequiredActions) {
    await client.query(
      `INSERT INTO "nonConformanceRequiredAction" (name, "systemType", "companyId", "createdBy") VALUES ($1, $2, $3, 'system')`,
      [nca.name, "systemType" in nca ? nca.systemType : null, companyId]
    );
  }

  for (const ca of changeOrderRequiredActions) {
    await client.query(
      `INSERT INTO "changeOrderRequiredAction" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
      [ca.name, companyId]
    );
  }

  for (const seq of sequences) {
    await client.query(
      `INSERT INTO sequence ("table", name, prefix, suffix, next, size, step, "companyId")
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
      [seq.table, seq.name, seq.prefix, seq.next, seq.size, seq.step, companyId]
    );
  }

  for (const c of currencies) {
    await client.query(
      `INSERT INTO currency (code, "exchangeRate", "decimalPlaces", "companyGroupId", "createdBy")
       VALUES ($1, $2, $3, $4, 'system')`,
      [c.code, c.exchangeRate, c.decimalPlaces, companyGroupId]
    );
  }

  const accountIdByKey: Record<string, string> = {};
  for (const { key, parentKey, ...acc } of accounts) {
    const result = await client.query(
      `INSERT INTO account (number, name, "isGroup", "accountType", "incomeBalance", class, "parentId", "isSystem", "companyGroupId", "createdBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'system') RETURNING id`,
      [
        acc.number,
        acc.name,
        acc.isGroup,
        acc.accountType,
        acc.incomeBalance,
        acc.class,
        parentKey ? (accountIdByKey[parentKey] ?? null) : null,
        ("isSystem" in acc ? acc.isSystem : false) ?? false,
        companyGroupId
      ]
    );
    if (result.rows[0]?.id) accountIdByKey[key] = result.rows[0].id;
  }

  for (const d of dimensions) {
    await client.query(
      `INSERT INTO dimension (name, "entityType", "companyGroupId", "createdBy")
       VALUES ($1, $2, $3, 'system')`,
      [d.name, d.entityType, companyGroupId]
    );
  }

  // Columns derive from the shared accountDefaults object so this insert
  // can't drift from seed.data.ts when new defaults are added.
  const accountDefaultEntries = Object.entries(accountDefaults);
  const accountDefaultColumns = [
    ...accountDefaultEntries.map(([column]) => `"${column}"`),
    `"companyId"`
  ];
  await client.query(
    `INSERT INTO "accountDefault" (${accountDefaultColumns.join(", ")})
     VALUES (${accountDefaultColumns.map((_, i) => `$${i + 1}`).join(", ")})`,
    [
      ...accountDefaultEntries.map(
        ([, number]) => accountIdByKey[number] ?? null
      ),
      companyId
    ]
  );

  await client.query(
    `INSERT INTO "fiscalYearSettings" ("startMonth", "taxStartMonth", "companyId", "updatedBy")
     VALUES ($1, $2, $3, 'system')`,
    [fiscalYearSettings.startMonth, fiscalYearSettings.taxStartMonth, companyId]
  );

  for (const fac of fixedAssetClasses) {
    await client.query(
      `INSERT INTO "fixedAssetClass" (
        "name", "depreciationMethod", "usefulLifeMonths", "residualValuePercent",
        "assetAccountId", "accumulatedDepreciationAccountId",
        "depreciationExpenseAccountId", "writeOffAccountId",
        "writeDownAccountId", "gainOnDisposalAccountId", "lossOnDisposalAccountId",
        "companyId", "createdBy"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'system')`,
      [
        fac.name,
        fac.depreciationMethod,
        fac.usefulLifeMonths,
        fac.residualValuePercent,
        accountIdByKey[fac.assetAccount],
        accountIdByKey[fac.accumulatedDepreciationAccount],
        accountIdByKey[fac.depreciationExpenseAccount],
        accountIdByKey[fac.writeOffAccount],
        accountIdByKey[fac.writeDownAccount],
        accountIdByKey[fac.gainOnDisposalAccount],
        accountIdByKey[fac.lossOnDisposalAccount],
        companyId
      ]
    );
  }

  // After accountDefaults — the location trigger copies posting groups from it.
  const locationResult = await client.query(
    `INSERT INTO location (name, "code", "addressLine1", city, "stateProvince", "postalCode", "countryCode", timezone, "companyId", "createdBy")
     VALUES ($1, 'HQ', $2, $3, $4, $5, $6, $7, $8, 'system') RETURNING id`,
    [
      defaultLocation.name,
      defaultLocation.addressLine1,
      defaultLocation.city,
      defaultLocation.stateProvince,
      defaultLocation.postalCode,
      defaultLocation.countryCode,
      defaultLocation.timezone,
      companyId
    ]
  );
  const locationId = locationResult.rows[0].id;

  await client.query(
    `INSERT INTO "employeeJob" (id, "companyId", "locationId") VALUES ($1, $2, $3)`,
    [userId, companyId, locationId]
  );

  const newPermissions: Record<string, string[]> = {};
  for (const module of modules) {
    const moduleName = module.name?.toLowerCase();
    if (!moduleName) continue;
    for (const type of ["view", "create", "update", "delete"]) {
      newPermissions[`${moduleName}_${type}`] = [companyId];
    }
  }

  const currentPermResult = await client.query(
    `SELECT permissions FROM "userPermission" WHERE id = $1`,
    [userId]
  );

  let finalPermissions = newPermissions;
  if (
    currentPermResult.rows.length > 0 &&
    currentPermResult.rows[0].permissions
  ) {
    const currentPerms = currentPermResult.rows[0].permissions as Record<
      string,
      string[]
    >;
    finalPermissions = { ...currentPerms };
    for (const [key, value] of Object.entries(newPermissions)) {
      if (key in finalPermissions) {
        if (!finalPermissions[key]!.includes(companyId)) {
          finalPermissions[key]!.push(companyId);
        }
      } else {
        finalPermissions[key] = value;
      }
    }
  }

  await client.query(
    `UPDATE "userPermission" SET permissions = $1 WHERE id = $2`,
    [JSON.stringify(finalPermissions), userId]
  );

  return { companyId, companyGroupId, locationId };
}
