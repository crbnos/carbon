import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import {
  accountDefaults,
  accounts,
  currencies,
  customerStatuses,
  dimensions,
  failureModes,
  fiscalYearSettings,
  fixedAssetClasses,
  gaugeTypes,
  groupCompanyTemplate,
  groups,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  scrapReasons,
  sequences,
  unitOfMeasures,
} from "../lib/seed.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const { companyId: id, userId, parentCompanyId } = await req.json();

  console.log({
    function: "seed-company",
    id,
    userId,
    parentCompanyId,
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

      // For subsidiaries: set companyGroupId and parentCompanyId
      if (parentCompanyId) {
        await trx
          .updateTable("company")
          .set({ companyGroupId, parentCompanyId })
          .where("id", "=", companyId)
          .execute();
      }

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

      // high-order groups
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

      await trx
        .insertInto("sequence")
        .values(sequences.map((s) => ({ ...s, companyId })))
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
            disposalAccountId: accountIdByKey[fac.disposalAccount]!,
            companyId,
            createdBy: userId,
          }))
        )
        .execute();

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

          await trx
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
            .execute();
        }
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
