import { resolveDate } from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import {
  insertId,
  insertMaybe,
  insertRow,
  maybeOne,
  need,
  one,
  RICH
} from "../sql.ts";
import type { Ctx } from "../types.ts";

// The currency codes a dataset references must exist for the company group —
// bootstrap seeds the full ISO set, so a miss is a typo'd code, not a gap.
async function assertCurrencyExists(ctx: Ctx, code: string): Promise<void> {
  const row = await maybeOne(
    ctx.client,
    `SELECT code FROM currency WHERE "companyGroupId" = $1 AND code = $2`,
    [ctx.companyGroupId, code]
  );
  if (!row) {
    throw new Error(
      `Seed: currency "${code}" does not exist for this company group`
    );
  }
}

export async function runTier1(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.foundation;
  const { client, companyId, locationId } = ctx;

  // ── Departments ──────────────────────────────────────────────────────────
  ctx.log("departments");
  for (const name of data.departments) {
    const id = await insertId(ctx, "department", { name });
    ctx.refs.departments[name] = id;
  }

  // ── Processes ─────────────────────────────────────────────────────────────
  // Processes come before abilities: an ability is a process's qualification
  // (it carries no name of its own), so each ability must link to a process.
  ctx.log("processes");
  for (const p of data.processes) {
    ctx.refs.processes[p.name] = await insertId(ctx, "process", {
      name: p.name,
      defaultStandardFactor: p.factor,
      processType: p.type
    });
  }

  // ── Abilities ─────────────────────────────────────────────────────────────
  // Each ability is the qualification for a process. Reuse a same-named process
  // when the dataset already defines one (marking it as requiring the ability);
  // otherwise mint a dedicated process for the qualification.
  ctx.log("abilities");
  for (const name of data.abilities) {
    let processId = ctx.refs.processes[name];
    if (processId) {
      await ctx.client.query(
        `UPDATE "process" SET "requiresAbility" = true WHERE "id" = $1 AND "companyId" = $2`,
        [processId, ctx.companyId]
      );
    } else {
      processId = await insertId(ctx, "process", {
        name,
        defaultStandardFactor: "Minutes/Piece",
        processType: "Process",
        requiresAbility: true
      });
      ctx.refs.processes[name] = processId;
    }
    ctx.refs.abilities[name] = await insertId(ctx, "ability", { processId });
  }

  // ── Item posting groups ───────────────────────────────────────────────────
  ctx.log("item posting groups");
  for (const name of data.itemPostingGroups) {
    ctx.refs.misc[`ipg:${name}`] = await insertId(ctx, "itemPostingGroup", {
      name
    });
  }

  // ── Second location (manufacturing plant) ─────────────────────────────────
  ctx.log("manufacturing location");
  const plantId = await insertId(ctx, "location", {
    name: data.plant.name,
    addressLine1: data.plant.addressLine1,
    city: data.plant.city,
    stateProvince: data.plant.stateProvince,
    postalCode: data.plant.postalCode,
    countryCode: data.plant.countryCode,
    timezone: data.plant.timezone
  });
  ctx.refs.locations.Plant = plantId;
  ctx.refs.locations.HQ = locationId;

  // ── Shifts ────────────────────────────────────────────────────────────────
  // At the plant: the work-center shift picker, the scheduler and Resource
  // Planning all read the shifts of the work centers' own location.
  ctx.log("shifts");
  for (const shift of data.shifts) {
    ctx.refs.shifts[shift.name] = await insertId(ctx, "shift", {
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      locationId: plantId,
      monday: shift.monday ?? false,
      tuesday: shift.tuesday ?? false,
      wednesday: shift.wednesday ?? false,
      thursday: shift.thursday ?? false,
      friday: shift.friday ?? false,
      saturday: shift.saturday ?? false,
      sunday: shift.sunday ?? false
    });
  }

  // Every job and work center lives at the plant, and both the MES board and
  // the ERP's location-scoped pages read the signed-in user's default location
  // (`userDefaults` is a view over employeeJob). Leave that at HQ and the shop
  // floor renders empty. Other employees move with the applying user.
  await ctx.client.query(
    `UPDATE "employeeJob" SET "locationId" = $2 WHERE "companyId" = $1`,
    [ctx.companyId, plantId]
  );
  // Upsert, not UPDATE: a company created outside bootstrap has no row for the
  // applying user, and the MES would then fall back to an arbitrary location.
  const job = data.employeeJob;
  ctx.log("employee job");
  await insertRow(
    ctx,
    "employeeJob",
    {
      id: ctx.userId,
      locationId: plantId,
      title: job.title,
      departmentId: need(ctx.refs.departments, job.department, "department"),
      shiftId: need(ctx.refs.shifts, job.shift, "shift"),
      startDate: resolveDate(ctx.anchor, job.startDateOffset),
      managerId: null,
      updatedBy: ctx.userId
    },
    {
      onConflict: `("id", "companyId") DO UPDATE SET
        "locationId" = EXCLUDED."locationId",
        "title" = EXCLUDED."title",
        "departmentId" = EXCLUDED."departmentId",
        "shiftId" = EXCLUDED."shiftId",
        "startDate" = EXCLUDED."startDate",
        "managerId" = NULL,
        "updatedBy" = EXCLUDED."updatedBy"`
    }
  );

  // ── Warehouses ────────────────────────────────────────────────────────────
  ctx.log("warehouses");
  for (const wh of data.warehouses) {
    ctx.refs.warehouses[wh.key] = await insertId(ctx, "warehouse", {
      name: wh.name,
      locationId: plantId,
      requiresPick: wh.requiresPick ?? false,
      requiresPutAway: wh.requiresPutAway ?? false,
      requiresBin: wh.requiresBin ?? false
    });
  }

  // ── Storage types ─────────────────────────────────────────────────────────
  ctx.log("storage types + units");
  const storageTypeIdByName = new Map<string, string>();
  for (const name of data.storageTypes) {
    const storageTypeId = await insertId(ctx, "storageType", { name });
    storageTypeIdByName.set(name, storageTypeId);
    ctx.refs.misc[`storagetype:${name}`] = storageTypeId;
  }

  // Array order is the contract: a parent shelf must be inserted before its
  // children. A name mismatch here silently dropped all opening stock before,
  // so every lookup throws instead.
  for (const shelf of data.shelves) {
    const storageTypeId = storageTypeIdByName.get(shelf.storageType);
    if (!storageTypeId) {
      throw new Error(
        `Seed: shelf "${shelf.name}" names unknown storageType "${shelf.storageType}"`
      );
    }
    let parentId: string | undefined;
    if (shelf.parent) {
      parentId = ctx.refs.shelves[shelf.parent];
      if (!parentId) {
        throw new Error(
          `Seed: shelf "${shelf.name}" names parent "${shelf.parent}", which is not defined before it`
        );
      }
    }
    ctx.refs.shelves[shelf.name] = await insertId(ctx, "storageUnit", {
      name: shelf.name,
      locationId: plantId,
      warehouseId: need(ctx.refs.warehouses, shelf.warehouse),
      parentId,
      storageTypeIds: [storageTypeId],
      active: true
    });
  }

  // ── Work centers (need dept + ability + location) ─────────────────────────
  ctx.log("work centers");
  for (const wc of data.workCenters) {
    const id = await insertId(ctx, "workCenter", {
      name: wc.name,
      departmentId: need(ctx.refs.departments, wc.dept, "department"),
      requiredAbilityId: need(ctx.refs.abilities, wc.ability, "ability"),
      locationId: plantId,
      laborRate: wc.laborRate,
      machineRate: wc.machineRate
    });
    ctx.refs.workCenters[wc.name] = id;
  }
  // The ERP's maintenance lists open on the first location by name (HQ), so
  // one work center there carries a schedule and a dispatch.
  const hq = data.hqWorkCenter;
  ctx.refs.workCenters[hq.name] = await insertId(ctx, "workCenter", {
    name: hq.name,
    departmentId: need(ctx.refs.departments, hq.dept, "department"),
    requiredAbilityId: need(ctx.refs.abilities, hq.ability, "ability"),
    locationId,
    laborRate: hq.laborRate,
    machineRate: hq.machineRate
  });

  // Link work centers to processes
  for (const [wc, proc] of data.workCenterProcessLinks) {
    await insertRow(ctx, "workCenterProcess", {
      workCenterId: need(ctx.refs.workCenters, wc, "work center"),
      processId: need(ctx.refs.processes, proc, "process")
    });
  }

  for (const [wc, shift] of data.workCenterShifts) {
    await insertRow(ctx, "workCenterShift", {
      workCenterId: need(ctx.refs.workCenters, wc, "work center"),
      shiftId: need(ctx.refs.shifts, shift, "shift")
    });
  }

  // Storage units for work centers (for floor-level inventory)
  for (const wc of data.workCenters) {
    const suId = await insertId(ctx, "storageUnit", {
      name: `${wc.name} Floor`,
      locationId: plantId,
      workCenterId: need(ctx.refs.workCenters, wc.name, "work center"),
      isWorkCenterDefault: true
    });
    ctx.refs.shelves[`wc:${wc.name}`] = suId;
  }

  // ── Customer types ────────────────────────────────────────────────────────
  ctx.log("customer types");
  for (const name of data.customerTypes) {
    ctx.refs.misc[`ctype:${name}`] = await insertId(ctx, "customerType", {
      name
    });
  }

  // ── Supplier types ────────────────────────────────────────────────────────
  ctx.log("supplier types");
  for (const name of data.supplierTypes) {
    ctx.refs.misc[`stype:${name}`] = await insertId(ctx, "supplierType", {
      name
    });
  }

  // ── Shipping methods ──────────────────────────────────────────────────────
  ctx.log("shipping methods");
  for (const name of data.shippingMethods) {
    const carrier = name.startsWith("UPS")
      ? "UPS"
      : name.startsWith("FedEx")
        ? "FedEx"
        : "Other";
    ctx.refs.shippingMethods[name] = await insertId(ctx, "shippingMethod", {
      name,
      carrier
    });
  }

  // ── Shipping terms ────────────────────────────────────────────────────────
  ctx.log("shipping terms");
  for (const name of data.shippingTerms) {
    ctx.refs.misc[`sterm:${name}`] = await insertId(ctx, "shippingTerm", {
      name
    });
  }

  // ── Payment term ids ──────────────────────────────────────────────────────
  // A party names a bootstrap term; Net 30 is the default.
  const netThirty = await one<{ id: string }>(
    client,
    `SELECT id FROM "paymentTerm" WHERE "companyId" = $1 AND name ILIKE '%net%30%' LIMIT 1`,
    [companyId]
  );
  ctx.refs.misc.paymentTermId = netThirty.id;

  const paymentTermFor = (spec: { paymentTerm?: string }): Promise<string> =>
    spec.paymentTerm
      ? bootstrapIdByName(ctx, "paymentTerm", spec.paymentTerm)
      : Promise.resolve(netThirty.id);

  // Currency codes referenced by any party must exist before the inserts.
  const currencyCodes = new Set<string>();
  for (const party of [...data.customers, ...data.suppliers]) {
    if (party.currencyCode) currencyCodes.add(party.currencyCode);
  }
  for (const code of currencyCodes) await assertCurrencyExists(ctx, code);

  // ── Customers ─────────────────────────────────────────────────────────────
  ctx.log("customers");
  for (const c of data.customers) {
    const statusId = await bootstrapIdByName(ctx, "customerStatus", c.status);
    const typeId = need(ctx.refs.misc, `ctype:${c.type}`, "customer type");
    const custId = await insertId(ctx, "customer", {
      name: c.name,
      customerTypeId: typeId,
      customerStatusId: statusId,
      phone: c.phone,
      website: c.website,
      currencyCode: c.currencyCode ?? "USD"
    });
    ctx.refs.customers[c.name] = custId;

    // Interceptor created customerPayment/Shipping/Tax — just update payment term
    await client.query(
      `UPDATE "customerPayment" SET "paymentTermId" = $1 WHERE "customerId" = $2`,
      [await paymentTermFor(c), custId]
    );
    await client.query(
      `UPDATE "customerShipping" SET "shippingMethodId" = $1 WHERE "customerId" = $2`,
      [need(ctx.refs.shippingMethods, data.defaultShippingMethod), custId]
    );
  }

  // Customer contacts
  for (const cc of data.customerContacts) {
    const customerId = need(ctx.refs.customers, cc.customer, "customer");
    const contactId = await insertId(ctx, "contact", {
      firstName: cc.firstName,
      lastName: cc.lastName,
      email: cc.email,
      title: cc.title,
      isCustomer: true
    });
    ctx.refs.contacts[`${cc.customer}:${cc.lastName}`] = contactId;

    const addrId = await insertId(ctx, "address", {
      addressLine1: "See parent",
      city: data.partyAddressCity,
      stateProvince: data.partyAddressStateProvince,
      postalCode: data.partyAddressPostalCode,
      countryCode: data.partyAddressCountryCode
    });
    const locId = await insertId(ctx, "customerLocation", {
      customerId,
      addressId: addrId,
      name: "Billing"
    });
    ctx.refs.misc[`cloc:${cc.customer}`] = locId;

    await insertId(ctx, "customerContact", {
      customerId,
      contactId,
      customerLocationId: locId
    });
  }

  // ── Suppliers ─────────────────────────────────────────────────────────────
  ctx.log("suppliers");
  for (const s of data.suppliers) {
    const typeId = need(ctx.refs.misc, `stype:${s.type}`, "supplier type");
    const supId = await insertId(ctx, "supplier", {
      name: s.name,
      supplierTypeId: typeId,
      phone: s.phone,
      website: s.website,
      currencyCode: s.currencyCode ?? "USD",
      supplierStatus: s.status ?? "Active"
    });
    ctx.refs.suppliers[s.name] = supId;

    await client.query(
      `UPDATE "supplierPayment" SET "paymentTermId" = $1 WHERE "supplierId" = $2`,
      [await paymentTermFor(s), supId]
    );
    await client.query(
      `UPDATE "supplierShipping" SET "shippingMethodId" = $1 WHERE "supplierId" = $2`,
      [need(ctx.refs.shippingMethods, data.defaultShippingMethod), supId]
    );
  }

  // Supplier contacts + addresses
  for (const sc of data.supplierContacts) {
    const supplierId = need(ctx.refs.suppliers, sc.supplier, "supplier");
    const contactId = await insertId(ctx, "contact", {
      firstName: sc.firstName,
      lastName: sc.lastName,
      email: sc.email,
      title: sc.title,
      isCustomer: false
    });
    ctx.refs.contacts[`${sc.supplier}:${sc.lastName}`] = contactId;

    const addrId = await insertId(ctx, "address", {
      addressLine1: "See supplier record",
      city: data.partyAddressCity,
      stateProvince: data.partyAddressStateProvince,
      postalCode: data.partyAddressPostalCode,
      countryCode: data.partyAddressCountryCode
    });
    const supLocId = await insertId(ctx, "supplierLocation", {
      supplierId,
      addressId: addrId,
      name: "Billing"
    });
    ctx.refs.misc[`sloc:${sc.supplier}`] = supLocId;

    const scId = await insertId(ctx, "supplierContact", {
      supplierId,
      contactId,
      supplierLocationId: supLocId
    });
    ctx.refs.contacts[`sc:${sc.supplier}`] = scId;
  }

  // ── Partners: a supplier location qualified for an ability ──────────────────
  ctx.log("partners");
  for (const partner of data.partners) {
    await insertRow(ctx, "partner", {
      id: need(ctx.refs.misc, `sloc:${partner.supplier}`, "supplier location"),
      abilityId: need(ctx.refs.abilities, partner.ability, "ability"),
      hoursPerWeek: partner.hoursPerWeek,
      active: true
    });
  }

  // ── Supplier processes (contract manufacturer) ────────────────────────────
  ctx.log("supplier processes");
  for (const sp of data.supplierProcesses) {
    const supplierId = need(ctx.refs.suppliers, sp.supplier, "supplier");
    const processId = need(ctx.refs.processes, sp.process, "process");
    const spId = await insertId(ctx, "supplierProcess", {
      supplierId,
      processId,
      leadTime: 5
    });
    ctx.refs.misc[`sp:${sp.supplier}:${sp.process}`] = spId;
  }

  // ── Contractors (need a supplierContact as their identity) ─────────────────
  // Contractors are individuals — they reference a supplierContact row for their
  // base identity, so they need an agency supplier to hang off.
  const agency = data.contractorAgency;
  if (agency) {
    ctx.log("contractors");
    const staffAgencyId = await insertId(ctx, "supplier", {
      name: agency.name,
      supplierTypeId: need(ctx.refs.misc, `stype:${agency.type}`),
      phone: agency.phone,
      currencyCode: "USD",
      supplierStatus: "Active"
    });
    ctx.refs.suppliers[agency.name] = staffAgencyId;

    for (const cd of data.contractors) {
      const cContactId = await insertId(ctx, "contact", {
        firstName: cd.firstName,
        lastName: cd.lastName,
        email: cd.email,
        isCustomer: false
      });
      const supContactId = await insertId(ctx, "supplierContact", {
        supplierId: staffAgencyId,
        contactId: cContactId
      });
      // contractor.id = the supplierContact.id
      await insertRow(ctx, "contractor", {
        id: supContactId,
        hoursPerWeek: 40
      });
      await insertRow(ctx, "contractorAbility", {
        contractorId: supContactId,
        abilityId: need(ctx.refs.abilities, cd.ability, "ability")
      });
    }
  }

  // ── Printer routes ─────────────────────────────────────────────────────────
  if (data.printerRoute) {
    ctx.log("printer routes");
    await insertRow(ctx, "printerRoute", {
      name: data.printerRoute.name,
      locationId: plantId,
      format: data.printerRoute.format,
      printerUrl: data.printerRoute.printerUrl,
      companyId
    });
  }

  // ── Procedures (shop-floor work instructions) ─────────────────────────────
  // Two versions of the same name: the version menu groups on `name`, so the
  // second version is what gives a procedure a readable history. Each version
  // carries its authored status (Draft / Active / Archived).
  ctx.log("procedures");
  for (const spec of data.procedures) {
    const processId = need(ctx.refs.processes, spec.process, "process");
    const latestVersion = Math.max(...spec.versions.map((v) => v.version));
    for (const version of spec.versions) {
      const procedureId = await insertId(ctx, "procedure", {
        name: spec.name,
        processId,
        version: version.version,
        status: version.status,
        content: RICH(spec.description)
      });
      if (version.version === latestVersion) {
        ctx.refs.misc[`procedure:${spec.name}`] = procedureId;
      }
      for (const parameter of spec.parameters ?? []) {
        await insertRow(ctx, "procedureParameter", {
          procedureId,
          key: parameter.key,
          value: parameter.value
        });
      }
      for (const [index, step] of version.steps.entries()) {
        await insertId(ctx, "procedureStep", {
          procedureId,
          name: step.name,
          type: step.type,
          sortOrder: index + 1,
          required: step.required ?? true,
          unitOfMeasureCode: step.unitOfMeasureCode ?? null,
          minValue: step.minValue ?? null,
          maxValue: step.maxValue ?? null,
          listValues: step.listValues ?? null,
          fileTypes: step.fileTypes ?? null,
          description: RICH(step.instruction)
        });
      }
    }
  }

  // ── Cost centers ───────────────────────────────────────────────────────────
  ctx.log("cost centers");
  for (const name of data.costCenters) {
    ctx.refs.misc[`cc:${name}`] = await insertId(ctx, "costCenter", { name });
  }

  // ── No-quote reasons ──────────────────────────────────────────────────────
  ctx.log("no-quote reasons");
  for (const name of data.noQuoteReasons) {
    ctx.refs.misc[`nqr:${name}`] = await insertId(ctx, "noQuoteReason", {
      name
    });
  }

  // ── Holidays ──────────────────────────────────────────────────────────────
  // insertMaybe: holiday is UNIQUE (date, companyId).
  ctx.log("holidays");
  for (const holiday of data.holidays) {
    // holiday.year is GENERATED ALWAYS from date — never insert it.
    await insertMaybe(ctx, "holiday", {
      name: holiday.name,
      date: resolveDate(ctx.anchor, holiday.dateOffset)
    });
  }

  // ── Tags ──────────────────────────────────────────────────────────────────
  // tag's PK is (name, table, companyId) — insertMaybe keeps re-seeds clean.
  ctx.log("tags");
  for (const tag of data.tags) {
    await insertMaybe(ctx, "tag", { name: tag.name, table: tag.table });
  }

  // ── Material taxonomy ─────────────────────────────────────────────────────
  // Company-scoped rows only (unique keys treat global rows as distinct), so
  // insertMaybe + a lookup by name is idempotent. Parents land before children
  // (FKs); helpers/items.ts resolves an item's classification the same way.
  ctx.log("material taxonomy");
  const taxonomy = data.materialTaxonomy;

  for (const substance of taxonomy.substances) {
    await insertMaybe(ctx, "materialSubstance", {
      name: substance.name,
      code: substance.code
    });
  }
  for (const form of taxonomy.forms) {
    await insertMaybe(ctx, "materialForm", {
      name: form.name,
      code: form.code
    });
  }
  for (const type of taxonomy.types) {
    await insertMaybe(ctx, "materialType", {
      name: type.name,
      code: type.code,
      materialSubstanceId: await bootstrapIdByName(
        ctx,
        "materialSubstance",
        type.substance
      ),
      materialFormId: await bootstrapIdByName(ctx, "materialForm", type.form)
    });
  }
  for (const grade of taxonomy.grades) {
    await insertMaybe(ctx, "materialGrade", {
      name: grade.name,
      materialSubstanceId: await bootstrapIdByName(
        ctx,
        "materialSubstance",
        grade.substance
      )
    });
  }
  for (const finish of taxonomy.finishes) {
    await insertMaybe(ctx, "materialFinish", {
      name: finish.name,
      materialSubstanceId: await bootstrapIdByName(
        ctx,
        "materialSubstance",
        finish.substance
      )
    });
  }
  for (const dimension of taxonomy.dimensions) {
    await insertMaybe(ctx, "materialDimension", {
      name: dimension.name,
      materialFormId: await bootstrapIdByName(
        ctx,
        "materialForm",
        dimension.form
      ),
      isMetric: dimension.isMetric ?? true
    });
  }

  // ── Employee resource links ───────────────────────────────────────────────
  // The seeded user gets two abilities and their job's shift so the People
  // screens have a real member. insertMaybe: both are UNIQUE (employeeId, <resource>Id).
  ctx.log("employee links");
  for (const abilityName of data.abilities.slice(0, 2)) {
    await insertMaybe(ctx, "employeeAbility", {
      employeeId: ctx.userId,
      abilityId: need(ctx.refs.abilities, abilityName, "ability"),
      lastTrainingDate: resolveDate(ctx.anchor, -30)
    });
  }
  await insertMaybe(ctx, "employeeShift", {
    employeeId: ctx.userId,
    shiftId: need(ctx.refs.shifts, data.employeeJob.shift, "shift")
  });
}
