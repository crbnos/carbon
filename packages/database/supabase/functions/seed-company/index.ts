import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import {
  accountDefaults,
  accounts,
  currencies,
  customerStatuses,
  dimensions,
  failureModes,
  fiscalYearSettings,
  fixedAssetClasses,
  changeOrderRequiredActions,
  changeOrderTypes,
  gaugeTypes,
  groupCompanyTemplate,
  groups,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  periodCloseTaskDefinitions,
  scrapReasons,
  sequences,
  unitOfMeasures,
} from "../lib/seed.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const { companyId: id, userId, parentCompanyId, identityOnly } =
    await req.json();

  console.log({
    function: "seed-company",
    id,
    userId,
    parentCompanyId,
    identityOnly: identityOnly === true,
  });

  try {
    if (!id) throw new Error("Payload is missing id");
    if (!userId) throw new Error("Payload is missing userId");

    const companyId = id as string;
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const company = await client
      .from("company")
      .select("*")
      .eq("id", companyId)
      .single();
    if (company.error) throw new Error(company.error.message);
    if (!company.data) throw new Error("Company not found");

    // Idempotency guard. The whole seed runs in a single transaction, so a
    // committed run has inserted `userToCompany(userId, companyId)`. The
    // service-role client retries on timeout / transient 5xx (fetchWithRetry),
    // so a seed that committed but whose HTTP response was lost gets re-invoked
    // with the same payload — re-running would throw 23505 on the identity
    // inserts. If the link already exists, the prior run finished: no-op.
    const existingLink = await client
      .from("userToCompany")
      .select("userId", { count: "exact", head: true })
      .eq("userId", userId)
      .eq("companyId", companyId);
      
    if ((existingLink.count ?? 0) > 0) {
      return jsonResponse({ success: true, alreadySeeded: true });
    }

    // Determine if this is a new root company or joining an existing group
    let companyGroupId = company.data.companyGroupId;
    const isNewGroup = !companyGroupId && !parentCompanyId;

    // If this is a subsidiary, get the parent's companyGroupId
    if (parentCompanyId && !companyGroupId) {
      const parent = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", parentCompanyId)
        .single();
      if (parent.error) throw new Error(parent.error.message);
      if (!parent.data?.companyGroupId)
        throw new Error("Parent company has no group");
      companyGroupId = parent.data.companyGroupId;
    }

    await db.transaction().execute(async (trx) => {
      // If no companyGroupId, create a new company group and assign it
      if (isNewGroup) {
        const companyGroupResult = await trx
          .insertInto("companyGroup")
          .values({
            name: company.data.name,
            createdBy: userId,
            ownerId: userId,
          })
          .returning(["id"])
          .execute();

        companyGroupId = companyGroupResult[0].id;
        if (!companyGroupId)
          throw new Error("Failed to create company group");

        await trx
          .updateTable("company")
          .set({ companyGroupId })
          .where("id", "=", companyId)
          .execute();
      }

      // For subsidiaries, companyGroupId + parentCompanyId are set LATER (just
      // before the elimination-entity block), not here. Setting companyGroupId
      // fires the `company_sync_ic_partners` trigger, which inserts an
      // intercompany supplier/customer row in this company for each sibling. Those
      // inserts rely on the `set_{supplier,customer}_readable_id_on_insert`
      // triggers to stamp a readableId from the company's sequence — and the
      // sequences aren't seeded until the reference-data block below. Firing the
      // trigger here left every intercompany row with readableId '' (the auto-fill
      // no-ops when no sequence row exists yet). Since
      // `supplier_readableId_companyId_unique` treats '' as a real value, only the
      // FIRST sibling's row survived; every later sibling collided on
      // (companyId, '') and was silently dropped by ON CONFLICT DO NOTHING — so a
      // company created into a group of 3+ only ever saw one sibling.

      await trx
        .withSchema("storage")
        .insertInto("buckets")
        .values({
          id: companyId,
          name: companyId,
          public: false,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();

      await trx
        .insertInto("userToCompany")
        .values([{ userId, companyId, role: "employee" }])
        .execute();

      // high-order groups — identity infrastructure: the employeeType insert
      // below fires a trigger that creates a membership row referencing these,
      // so they must exist even in identity-only mode. (The onboarding import
      // skips `group` so the template doesn't duplicate them.)
      await trx
        .insertInto("group")
        .values(
          groups.map((g) => ({
            ...g,
            id: g.id.replace(
              groupCompanyTemplate,
              `${companyId.substring(0, 4)}-${companyId.substring(
                4,
                8
              )}-${companyId.substring(8, 20)}`
            ),
            companyId,
          }))
        )
        .execute();

      const employeeTypes = await trx
        .insertInto("employeeType")
        .values([
          {
            name: "Admin",
            companyId,
            protected: true,
            systemType: "Admin" as const,
          },
        ])
        .returning(["id"])
        .execute();

      const employeeTypeId = employeeTypes[0].id;
      if (!employeeTypeId)
        throw new Error("Failed to insert admin employee type");

      // get the modules
      const modules = await trx.selectFrom("modules").select("name").execute() as { name: string }[];

      // create employee type permissions for admin
      const employeeTypePermissions = modules.reduce<
        Database["public"]["Tables"]["employeeTypePermission"]["Insert"][]
      >((acc, module) => {
        if (module.name) {
          acc.push({
            employeeTypeId: employeeTypeId,
            // @ts-expect-error - it's legit, chill typescript
            module: module.name,
            create: [companyId],
            update: [companyId],
            delete: [companyId],
            view: [companyId],
          });
        }
        return acc;
      }, []);

      // insert employee type permissions
      await trx
        .insertInto("employeeTypePermission")
        .values(employeeTypePermissions)
        .execute();

      // insert employee
      await trx
        .insertInto("employee")
        .values([
          {
            id: String(userId),
            employeeTypeId,
            companyId,
            active: true,
          },
        ])
        .execute();

      // Reference + accounting data (customer statuses, UoMs, sequences,
      // chart of accounts, …). Skipped in identity-only mode — a company
      // backup carries all of this, so onboarding-from-a-backup seeds only
      // the identity layer above and lets the import provide the rest.
      if (!identityOnly) {
      // customer status
      await trx
        .insertInto("customerStatus")
        .values(
          customerStatuses.map((name) => ({
            name,
            companyId,
            createdBy: "system",
          }))
        )
        .execute();

      // scrap reason codes
      await trx
        .insertInto("scrapReason")
        .values(
          scrapReasons.map((name) => ({
            name,
            companyId,
            createdBy: "system",
          }))
        )
        .execute();

      // payment terms
      await trx
        .insertInto("paymentTerm")
        .values(paymentTerms.map((pt) => ({ ...pt, companyId })))
        .execute();

      await trx
        .insertInto("unitOfMeasure")
        .values(unitOfMeasures.map((uom) => ({ ...uom, companyId })))
        .execute();

      await trx
        .insertInto("gaugeType")
        .values(
          gaugeTypes.map((gt) => ({ name: gt, companyId, createdBy: "system" }))
        )
        .execute();

      await trx
        .insertInto("maintenanceFailureMode")
        .values(failureModes.map((name) => ({ name, companyId, createdBy: "system" })))
        .execute();

      await trx
        .insertInto("nonConformanceType")
        .values(nonConformanceTypes.map((nc) => ({ ...nc, companyId })))
        .execute();

      await trx
        .insertInto("nonConformanceRequiredAction")
        .values(
          nonConformanceRequiredActions.map((nc) => ({ ...nc, companyId }))
        )
        .execute();

      // change-order default types (the changeOrderType lookup). New on this
      // branch and not yet in the cloud-generated Kysely types, so the insert
      // goes through a cast (mirrors changeOrderRequiredAction below).
      await (trx as any)
        .insertInto("changeOrderType")
        .values(changeOrderTypes.map((ct) => ({ ...ct, companyId })))
        .execute();

      // change-order default actions (system template rows). New on this branch
      // and not yet in the cloud-generated Kysely types, so the insert goes
      // through a cast (mirrors periodCloseTaskDefinition below).
      await (trx as any)
        .insertInto("changeOrderRequiredAction")
        .values(
          changeOrderRequiredActions.map((ca) => ({ ...ca, companyId }))
        )
        .execute();

      await trx
        .insertInto("sequence")
        .values(sequences.map((s) => ({ ...s, companyId })))
        .execute();

      // period-close checklist definitions (system template rows). The table is
      // new on this branch and not yet in the cloud-generated Kysely types, so
      // the insert goes through a cast (mirrors accounting.ee.service.ts).
      await (trx as any)
        .insertInto("periodCloseTaskDefinition")
        .values(
          periodCloseTaskDefinitions.map((d) => ({
            ...d,
            companyId,
            createdBy: "system",
          }))
        )
        .execute();

      // Shared tables: only seed for new groups (existing groups already have these)
      let accountIdByKey: Record<string, string> = {};
      if (isNewGroup) {
        await trx
          .insertInto("currency")
          .values(currencies.map((c) => ({ ...c, companyGroupId })))
          .execute();

        // Insert accounts in order, resolving parentKey to parentId
        for (const { key, parentKey, ...acc } of accounts) {
          const result = await trx
            .insertInto("account")
            .values({
              ...acc,
              companyGroupId,
              parentId: parentKey ? accountIdByKey[parentKey] ?? null : null,
            })
            .returning(["id"])
            .execute();
          if (result[0]?.id) {
            accountIdByKey[key] = result[0].id;
          }
        }

        await trx
          .insertInto("dimension")
          .values(
            dimensions.map((d) => ({
              name: d.name,
              entityType: d.entityType,
              companyGroupId,
              createdBy: userId,
            }))
          )
          .execute();
      } else {
        // For subsidiaries joining an existing group, look up account IDs by number
        const existingAccounts = await trx
          .selectFrom("account")
          .select(["id", "number"])
          .where("companyGroupId", "=", companyGroupId!)
          .where("number", "is not", null)
          .execute();
        for (const acc of existingAccounts) {
          if (acc.number) {
            accountIdByKey[acc.number] = acc.id;
          }
        }
      }

      // Resolve account numbers to IDs for account defaults
      const resolvedDefaults: Record<string, string | null> = {};
      for (const [key, number] of Object.entries(accountDefaults)) {
        resolvedDefaults[key] = accountIdByKey[number] ?? null;
      }

      // These defaults are NOT NULL in the schema. If a customized COA
      // on an existing group is missing one of their accounts
      // (6050/4130/4120/7060/1150/1210/1220), the lookup yields null and the
      // insert below would violate the not-null constraint. Fall back to an
      // existing default of the same nature so the insert can't fail — mirrors
      // the COALESCE backfills in 20260630093809_ar-ap-payments.sql,
      // 20260711155312_supplier-prepayment-account.sql, and
      // 20260713190909_raw-materials-finished-goods-accounts.sql.
      // Order matters: rawMaterialsAccount resolves before finishedGoodsAccount
      // chains onto it.
      const arApDefaultFallbacks: Record<string, string> = {
        customerWriteOffAccount: "salesDiscountAccount",
        supplierWriteOffAccount: "salesAccount",
        realizedExchangeGainAccount: "salesAccount",
        realizedExchangeLossAccount: "interestAccount",
        assetGainOnDisposalAccount: "assetLossOnDisposalAccount",
        supplierPrepaymentAccount: "receivablesAccount",
        rawMaterialsAccount: "workInProgressAccount",
        finishedGoodsAccount: "rawMaterialsAccount",
      };
      for (const [key, fallbackKey] of Object.entries(arApDefaultFallbacks)) {
        if (!resolvedDefaults[key]) {
          resolvedDefaults[key] = resolvedDefaults[fallbackKey] ?? null;
        }
      }

      // Company-specific accounting defaults and posting groups
      await trx
        .insertInto("accountDefault")
        .values([
          {
            ...resolvedDefaults,
            companyId,
          },
        ])
        .execute();

      await trx
        .insertInto("fiscalYearSettings")
        .values([{ ...fiscalYearSettings, companyId }])
        .execute();

      await trx
        .insertInto("fixedAssetClass")
        .values(
          fixedAssetClasses.map((fac) => ({
            name: fac.name,
            depreciationMethod: fac.depreciationMethod,
            usefulLifeMonths: fac.usefulLifeMonths,
            residualValuePercent: fac.residualValuePercent,
            assetAccountId: accountIdByKey[fac.assetAccount]!,
            accumulatedDepreciationAccountId:
              accountIdByKey[fac.accumulatedDepreciationAccount]!,
            depreciationExpenseAccountId:
              accountIdByKey[fac.depreciationExpenseAccount]!,
            writeOffAccountId: accountIdByKey[fac.writeOffAccount]!,
            writeDownAccountId: accountIdByKey[fac.writeDownAccount]!,
            gainOnDisposalAccountId: accountIdByKey[fac.gainOnDisposalAccount]!,
            lossOnDisposalAccountId: accountIdByKey[fac.lossOnDisposalAccount]!,
            companyId,
            createdBy: userId,
          }))
        )
        .execute();
      } // end if (!identityOnly)

      const user = await client
        .from("userPermission")
        .select("permissions")
        .eq("id", userId)
        .single();
      if (user.error) throw new Error(user.error.message);

      const currentPermissions = (user.data?.permissions ?? {}) as Record<
        string,
        string[]
      >;
      const newPermissions = { ...currentPermissions };
      modules.forEach(({ name }) => {
        const module = name?.toLowerCase();
        if (`${module}_view` in newPermissions) {
          newPermissions[`${module}_view`].push(companyId);
        } else {
          newPermissions[`${module}_view`] = [companyId];
        }

        if (`${module}_create` in newPermissions) {
          newPermissions[`${module}_create`].push(companyId);
        } else {
          newPermissions[`${module}_create`] = [companyId];
        }

        if (`${module}_update` in newPermissions) {
          newPermissions[`${module}_update`].push(companyId);
        } else {
          newPermissions[`${module}_update`] = [companyId];
        }

        if (`${module}_delete` in newPermissions) {
          newPermissions[`${module}_delete`].push(companyId);
        } else {
          newPermissions[`${module}_delete`] = [companyId];
        }
      });

      const { error } = await client
        .from("userPermission")
        .update({ permissions: newPermissions })
        .eq("id", userId);
      if (error) throw new Error(error.message);

      // For subsidiaries: set companyGroupId + parentCompanyId now that the
      // reference data (including the supplier/customer sequences) has been
      // seeded. This is what fires `company_sync_ic_partners`; running it here
      // guarantees the readableId auto-fill triggers can stamp a real id on every
      // intercompany partner row, so no two siblings collide on (companyId, '').
      if (parentCompanyId) {
        await trx
          .updateTable("company")
          .set({ companyGroupId, parentCompanyId })
          .where("id", "=", companyId)
          .execute();
      }

      // Auto-create elimination entity if this is a subsidiary
      if (parentCompanyId && companyGroupId) {
        const siblings = await trx
          .selectFrom("company")
          .select(["id", "isEliminationEntity"])
          .where("companyGroupId", "=", companyGroupId)
          .where("parentCompanyId", "=", parentCompanyId)
          .execute();

        const hasElimination = siblings.some(
          (s) => s.isEliminationEntity
        );

        if (!hasElimination) {
          const parent = await trx
            .selectFrom("company")
            .select(["name", "baseCurrencyCode", "countryCode"])
            .where("id", "=", parentCompanyId)
            .executeTakeFirst();

          const eliminationCompany = await trx
            .insertInto("company")
            .values({
              name: `Elimination - ${parent?.name ?? "Unknown"}`,
              addressLine1: "",
              city: "",
              stateProvince: "",
              postalCode: "",
              baseCurrencyCode:
                parent?.baseCurrencyCode ??
                company.data.baseCurrencyCode,
              countryCode:
                parent?.countryCode ?? company.data.countryCode ?? "",
              parentCompanyId,
              isEliminationEntity: true,
              companyGroupId,
            })
            .returning(["id"])
            .executeTakeFirst();

          // Seed sequences for the elimination entity. It is otherwise a bare
          // consolidation shell, but generateEliminationEntries posts an
          // elimination journal on it and stamps journalEntryId from
          // get_next_sequence('journalEntry', <elim>) — without its own
          // sequence rows that raises "Sequence not found".
          if (eliminationCompany?.id) {
            await trx
              .insertInto("sequence")
              .values(
                sequences.map((s) => ({
                  ...s,
                  companyId: eliminationCompany.id,
                }))
              )
              .execute();
          }
        }
      }
    });

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
