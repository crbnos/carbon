/**
 * Development seed script for Carbon
 *
 * This script creates a development user and company with all default seed data.
 * Run after `pnpm run db:build` to set up a fully functional local environment.
 *
 * Usage:
 *   pnpm run db:seed:dev -- --email your@email.com
 */

import process from "node:process";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import {
  accountDefaults,
  accounts,
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
  scrapReasons,
  sequences,
  unitOfMeasures
} from "../supabase/functions/lib/seed.data.ts";
import { getPostgresConnectionPool } from "./client.ts";
import { seedPrinting } from "./seed-printing.ts";
import type { Database } from "./types.ts";

// Load environment variables
dotenv.config();

const DEV_PASSWORD = "password";
const DEV_COMPANY_NAME = "Carbon Development";

/**
 * Infers a first name from an email address.
 * Takes the local part (before @), splits on common delimiters (., +, _),
 * takes the first segment, and capitalizes it.
 */
function inferFirstNameFromEmail(email: string): string {
  const localPart = email.split("@")[0]!;
  // Split on common delimiters and take the first part
  const firstName = localPart.split(/[.+_-]/)[0]!;
  // Capitalize first letter, lowercase the rest
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

// Parse CLI arguments
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    email: {
      type: "string",
      short: "e"
    },
    printing: {
      type: "boolean",
      default: false
    }
  },
  strict: true
});

function printUsage() {
  console.log(`
Usage: pnpm run db:seed:dev -- --email <email> [--printing]

Arguments:
  --email, -e    Required. The email address for the dev user.
  --printing     Optional. Seed printing test data (printer routes, receipts, etc.).

Example:
  pnpm run db:seed:dev -- --email developer@example.com
  pnpm run db:seed:dev -- --email developer@example.com --printing
  `);
}

async function seedDev() {
  const email = values.email;

  if (!email) {
    console.error("Error: --email is required\n");
    printUsage();
    process.exit(1);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error("Error: Invalid email format\n");
    process.exit(1);
  }

  console.log(`\nSeeding development environment for: ${email}\n`);

  // Initialize Supabase admin client
  const supabaseAdmin = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  // Initialize PostgreSQL connection pool
  const pgPool = getPostgresConnectionPool(1);
  const client = await pgPool.connect();

  try {
    // Step 1: Check if user already exists (via Supabase Auth API - cannot be in transaction)
    console.log("1. Checking for existing user...");
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(
      (u: any) => u.email === (email ?? "")
    );

    let userId: string;

    if (existingUser) {
      console.log(`   User ${email} already exists, using existing user.`);
      userId = existingUser.id;

      // Update password to known value
      const { error: updateError } =
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: DEV_PASSWORD
        });
      if (updateError) {
        console.warn(
          `   Warning: Could not update password: ${updateError.message}`
        );
      } else {
        console.log(`   Password updated to: ${DEV_PASSWORD}`);
      }
    } else {
      // Create new user
      console.log("   Creating new user...");
      const { data: newUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: DEV_PASSWORD,
          email_confirm: true,
          app_metadata: {
            role: "employee",
            provider: "email",
            providers: ["email"]
          }
        });

      if (createError) {
        throw new Error(`Failed to create user: ${createError.message}`);
      }

      if (!newUser.user) {
        throw new Error("Failed to create user: No user returned");
      }

      userId = newUser.user.id;
      console.log(`   User created with ID: ${userId}`);
    }

    // Step 2: Update user's first name (inferred from email)
    const firstName = inferFirstNameFromEmail(email ?? "");
    console.log(`2. Updating user first name to "${firstName}"...`);
    await client.query(`UPDATE "user" SET "firstName" = $1 WHERE id = $2`, [
      firstName,
      userId
    ]);

    // Step 3: Begin transaction for all database operations
    console.log("3. Starting database transaction...");
    await client.query("BEGIN");

    try {
      // Generate company ID using xid() function
      console.log("4. Generating company ID...");
      const xidResult = await client.query("SELECT xid() as id");
      const companyId = xidResult.rows[0].id as string;
      console.log(`   Company ID: ${companyId}`);

      // Create company group
      console.log("5. Creating company group...");
      const companyGroupResult = await client.query(
        `INSERT INTO "companyGroup" (name, "createdBy") VALUES ($1, $2) RETURNING id`,
        [DEV_COMPANY_NAME, userId]
      );
      const companyGroupId = companyGroupResult.rows[0].id as string;
      console.log(`   Company Group ID: ${companyGroupId}`);

      // Create the company
      console.log("6. Creating company...");
      await client.query(
        `INSERT INTO company (id, name, "baseCurrencyCode", "companyGroupId") VALUES ($1, $2, 'USD', $3)`,
        [companyId, DEV_COMPANY_NAME, companyGroupId]
      );
      console.log(`   Company "${DEV_COMPANY_NAME}" created.`);

      // Seed the company with all default data
      console.log("7. Seeding company with default data...");

      // Create storage bucket
      await client.query(
        `INSERT INTO storage.buckets (id, name, public) VALUES ($1, $2, false)`,
        [companyId, companyId]
      );

      // Link user to company
      await client.query(
        `INSERT INTO "userToCompany" ("userId", "companyId", "role") VALUES ($1, $2, 'employee')`,
        [userId, companyId]
      );

      // Create groups
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

      // Create Admin employee type
      const employeeTypeResult = await client.query(
        `INSERT INTO "employeeType" (name, "companyId", protected, "systemType") VALUES ('Admin', $1, true, 'Admin') RETURNING id`,
        [companyId]
      );
      const employeeTypeId = employeeTypeResult.rows[0].id;

      // Get available modules
      const modulesResult = await client.query(`SELECT name FROM modules`);
      const modules = modulesResult.rows as { name: string }[];

      // Create employee type permissions
      for (const module of modules) {
        if (module.name) {
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
      }

      // Create employee record
      await client.query(
        `INSERT INTO employee (id, "employeeTypeId", "companyId", active) VALUES ($1, $2, $3, true)`,
        [userId, employeeTypeId, companyId]
      );

      // Seed customer statuses
      for (const name of customerStatuses) {
        await client.query(
          `INSERT INTO "customerStatus" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
          [name, companyId]
        );
      }

      // Seed scrap reasons
      for (const name of scrapReasons) {
        await client.query(
          `INSERT INTO "scrapReason" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
          [name, companyId]
        );
      }

      // Seed payment terms
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

      // Seed units of measure
      for (const uom of unitOfMeasures) {
        await client.query(
          `INSERT INTO "unitOfMeasure" (name, code, "companyId", "createdBy") VALUES ($1, $2, $3, 'system')`,
          [uom.name, uom.code, companyId]
        );
      }

      // Seed gauge types
      for (const gt of gaugeTypes) {
        await client.query(
          `INSERT INTO "gaugeType" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
          [gt, companyId]
        );
      }

      // Seed maintenance failure modes
      for (const fm of failureModes) {
        await client.query(
          `INSERT INTO "maintenanceFailureMode" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
          [fm, companyId]
        );
      }

      // Seed non-conformance types
      for (const nct of nonConformanceTypes) {
        await client.query(
          `INSERT INTO "nonConformanceType" (name, "companyId", "createdBy") VALUES ($1, $2, 'system')`,
          [nct.name, companyId]
        );
      }

      // Seed non-conformance required actions
      for (const nca of nonConformanceRequiredActions) {
        await client.query(
          `INSERT INTO "nonConformanceRequiredAction" (name, "systemType", "companyId", "createdBy") VALUES ($1, $2, $3, 'system')`,
          [nca.name, "systemType" in nca ? nca.systemType : null, companyId]
        );
      }

      // Seed sequences
      for (const seq of sequences) {
        await client.query(
          `INSERT INTO sequence ("table", name, prefix, suffix, next, size, step, "companyId")
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
          [
            seq.table,
            seq.name,
            seq.prefix,
            seq.next,
            seq.size,
            seq.step,
            companyId
          ]
        );
      }

      // Seed currencies
      for (const c of currencies) {
        await client.query(
          `INSERT INTO currency (code, "exchangeRate", "decimalPlaces", "companyGroupId", "createdBy")
           VALUES ($1, $2, $3, $4, 'system')`,
          [c.code, c.exchangeRate, c.decimalPlaces, companyGroupId]
        );
      }

      // Seed accounts (chart of accounts) - insert in order, resolving parentKey to parentId
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
        if (result.rows[0]?.id) {
          accountIdByKey[key] = result.rows[0].id;
        }
      }

      // Seed dimensions for all entity types
      for (const d of dimensions) {
        await client.query(
          `INSERT INTO dimension (name, "entityType", "companyGroupId", "createdBy")
           VALUES ($1, $2, $3, 'system')`,
          [d.name, d.entityType, companyGroupId]
        );
      }

      // Resolve account numbers to IDs for account defaults
      const resolveAccountId = (number: string) =>
        accountIdByKey[number] ?? null;

      // Seed account defaults
      await client.query(
        `INSERT INTO "accountDefault" (
          "salesAccount", "salesDiscountAccount", "costOfGoodsSoldAccount",
          "purchaseVarianceAccount", "inventoryAdjustmentVarianceAccount",
          "materialVarianceAccount", "laborAndMachineVarianceAccount",
          "overheadVarianceAccount", "lotSizeVarianceAccount", "subcontractingVarianceAccount",
          "laborAbsorptionAccount", "indirectCostAccount", "maintenanceAccount", "assetDepreciationExpenseAccount",
          "assetGainsAndLossesAccount", "serviceChargeAccount", "interestAccount",
          "supplierPaymentDiscountAccount", "customerPaymentDiscountAccount", "roundingAccount",
          "assetAquisitionCostAccount", "assetAquisitionCostOnDisposalAccount",
          "accumulatedDepreciationAccount", "accumulatedDepreciationOnDisposalAccount",
          "inventoryAccount", "workInProgressAccount",
          "receivablesAccount", "bankCashAccount",
          "bankLocalCurrencyAccount", "bankForeignCurrencyAccount", "prepaymentAccount",
          "payablesAccount", "goodsReceivedNotInvoicedAccount", "inventoryShippedNotInvoicedAccount",
          "salesTaxPayableAccount", "purchaseTaxPayableAccount", "reverseChargeSalesTaxPayableAccount",
          "retainedEarningsAccount", "currencyTranslationAccount",
          "customerWriteOffAccount", "supplierWriteOffAccount",
          "realizedExchangeGainAccount", "realizedExchangeLossAccount", "companyId"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44
        )`,
        [
          resolveAccountId(accountDefaults.salesAccount),
          resolveAccountId(accountDefaults.salesDiscountAccount),
          resolveAccountId(accountDefaults.costOfGoodsSoldAccount),
          resolveAccountId(accountDefaults.purchaseVarianceAccount),
          resolveAccountId(accountDefaults.inventoryAdjustmentVarianceAccount),
          resolveAccountId(accountDefaults.materialVarianceAccount),
          resolveAccountId(accountDefaults.laborAndMachineVarianceAccount),
          resolveAccountId(accountDefaults.overheadVarianceAccount),
          resolveAccountId(accountDefaults.lotSizeVarianceAccount),
          resolveAccountId(accountDefaults.subcontractingVarianceAccount),
          resolveAccountId(accountDefaults.laborAbsorptionAccount),
          resolveAccountId(accountDefaults.indirectCostAccount),
          resolveAccountId(accountDefaults.maintenanceAccount),
          resolveAccountId(accountDefaults.assetDepreciationExpenseAccount),
          resolveAccountId(accountDefaults.assetGainsAndLossesAccount),
          resolveAccountId(accountDefaults.serviceChargeAccount),
          resolveAccountId(accountDefaults.interestAccount),
          resolveAccountId(accountDefaults.supplierPaymentDiscountAccount),
          resolveAccountId(accountDefaults.customerPaymentDiscountAccount),
          resolveAccountId(accountDefaults.roundingAccount),
          resolveAccountId(accountDefaults.assetAquisitionCostAccount),
          resolveAccountId(
            accountDefaults.assetAquisitionCostOnDisposalAccount
          ),
          resolveAccountId(accountDefaults.accumulatedDepreciationAccount),
          resolveAccountId(
            accountDefaults.accumulatedDepreciationOnDisposalAccount
          ),
          resolveAccountId(accountDefaults.inventoryAccount),
          resolveAccountId(accountDefaults.workInProgressAccount),
          resolveAccountId(accountDefaults.receivablesAccount),
          resolveAccountId(accountDefaults.bankCashAccount),
          resolveAccountId(accountDefaults.bankLocalCurrencyAccount),
          resolveAccountId(accountDefaults.bankForeignCurrencyAccount),
          resolveAccountId(accountDefaults.prepaymentAccount),
          resolveAccountId(accountDefaults.payablesAccount),
          resolveAccountId(accountDefaults.goodsReceivedNotInvoicedAccount),
          resolveAccountId(accountDefaults.inventoryShippedNotInvoicedAccount),
          resolveAccountId(accountDefaults.salesTaxPayableAccount),
          resolveAccountId(accountDefaults.purchaseTaxPayableAccount),
          resolveAccountId(accountDefaults.reverseChargeSalesTaxPayableAccount),
          resolveAccountId(accountDefaults.retainedEarningsAccount),
          resolveAccountId(accountDefaults.currencyTranslationAccount),
          resolveAccountId(accountDefaults.customerWriteOffAccount),
          resolveAccountId(accountDefaults.supplierWriteOffAccount),
          resolveAccountId(accountDefaults.realizedExchangeGainAccount),
          resolveAccountId(accountDefaults.realizedExchangeLossAccount),
          companyId
        ]
      );

      // Seed fiscal year settings
      await client.query(
        `INSERT INTO "fiscalYearSettings" ("startMonth", "taxStartMonth", "companyId", "updatedBy")
         VALUES ($1, $2, $3, 'system')`,
        [
          fiscalYearSettings.startMonth,
          fiscalYearSettings.taxStartMonth,
          companyId
        ]
      );

      // Seed fixed asset classes
      for (const fac of fixedAssetClasses) {
        await client.query(
          `INSERT INTO "fixedAssetClass" (
            "name", "depreciationMethod", "usefulLifeMonths", "residualValuePercent",
            "assetAccountId", "accumulatedDepreciationAccountId",
            "depreciationExpenseAccountId", "writeOffAccountId",
            "writeDownAccountId", "disposalAccountId",
            "companyId", "createdBy"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'system')`,
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
            accountIdByKey[fac.disposalAccount],
            companyId
          ]
        );
      }

      // Seed default location (required for inventory, jobs, etc.)
      // Must be after accountDefaults since location trigger copies from accountDefaults
      const locationResult = await client.query(
        `INSERT INTO location (name, "addressLine1", city, "stateProvince", "postalCode", "countryCode", timezone, "companyId", "createdBy")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system') RETURNING id`,
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

      // Link employee to location (employeeJob)
      await client.query(
        `INSERT INTO "employeeJob" (id, "companyId", "locationId") VALUES ($1, $2, $3)`,
        [userId, companyId, locationId]
      );

      // Update user permissions
      console.log("7. Updating user permissions...");

      // Build permissions object
      const newPermissions: Record<string, string[]> = {};
      for (const module of modules) {
        const moduleName = module.name?.toLowerCase();
        if (!moduleName) continue;

        const permissionTypes = ["view", "create", "update", "delete"];
        for (const type of permissionTypes) {
          const key = `${moduleName}_${type}`;
          newPermissions[key] = [companyId];
        }
      }

      // Get current permissions and merge
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

      console.log("   User permissions updated.");

      // Seed printing test data (opt-in via --printing flag)
      if (values.printing) {
        console.log("8. Seeding printing test data...");
        await seedPrinting(client, { companyId, userId, locationId });
      }

      // Commit the transaction
      await client.query("COMMIT");
      console.log("   Transaction committed successfully.");

      // Success!
      console.log(`
========================================
Dev environment seeded successfully!
========================================

Login credentials:
  Email:    ${email}
  Password: ${DEV_PASSWORD}

Company: ${DEV_COMPANY_NAME}
Company ID: ${companyId}

You can now start the app and log in!
`);
    } catch (err) {
      // Rollback on any error
      await client.query("ROLLBACK");
      console.error("   Transaction rolled back due to error.");
      throw err;
    }
  } catch (error) {
    console.error("\nError seeding development environment:");
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pgPool.end();
  }
}

seedDev();
