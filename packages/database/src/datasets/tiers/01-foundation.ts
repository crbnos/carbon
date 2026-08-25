import { insertId, insertRow, need, one, RICH, rows } from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier1(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.foundation;
  const { client, companyId, locationId } = ctx;

  // ── Departments ──────────────────────────────────────────────────────────
  ctx.log("departments");
  for (const name of data.departments) {
    const id = await insertId(ctx, "department", { name });
    ctx.refs.departments[name] = id;
  }

  // ── Shifts ────────────────────────────────────────────────────────────────
  ctx.log("shifts");
  for (const shift of data.shifts) {
    ctx.refs.shifts[shift.name] = await insertId(ctx, "shift", {
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      locationId,
      monday: shift.monday ?? false,
      tuesday: shift.tuesday ?? false,
      wednesday: shift.wednesday ?? false,
      thursday: shift.thursday ?? false,
      friday: shift.friday ?? false,
      saturday: shift.saturday ?? false,
      sunday: shift.sunday ?? false
    });
  }

  // ── Abilities ─────────────────────────────────────────────────────────────
  ctx.log("abilities");
  for (const name of data.abilities) {
    ctx.refs.abilities[name] = await insertId(ctx, "ability", { name });
  }

  // ── Processes ─────────────────────────────────────────────────────────────
  ctx.log("processes");
  for (const p of data.processes) {
    ctx.refs.processes[p.name] = await insertId(ctx, "process", {
      name: p.name,
      defaultStandardFactor: p.factor,
      processType: p.type
    });
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

  // Every job and work center lives at the plant, and both the MES board and
  // the ERP's location-scoped pages read the signed-in user's default location.
  // Leave that at HQ and the shop floor renders empty.
  await ctx.client.query(
    `UPDATE "employeeJob" SET "locationId" = $2 WHERE "companyId" = $1`,
    [ctx.companyId, plantId]
  );
  // (`userDefaults` is a view over employeeJob — the UPDATE above is what moves it.)

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
    storageTypeIdByName.set(name, await insertId(ctx, "storageType", { name }));
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

  // Link work centers to processes
  for (const [wc, proc] of data.workCenterProcessLinks) {
    await insertRow(ctx, "workCenterProcess", {
      workCenterId: need(ctx.refs.workCenters, wc, "work center"),
      processId: need(ctx.refs.processes, proc, "process")
    });
  }

  // Storage units for work centers (for floor-level inventory)
  for (const wc of data.workCenters) {
    const suId = await insertId(ctx, "storageUnit", {
      name: `${wc.name} Floor`,
      locationId: plantId,
      workCenterId: ctx.refs.workCenters[wc.name],
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

  // ── Payment term id ───────────────────────────────────────────────────────
  const netThirty = await one<{ id: string }>(
    client,
    `SELECT id FROM "paymentTerm" WHERE "companyId" = $1 AND name ILIKE '%net%30%' LIMIT 1`,
    [companyId]
  );
  ctx.refs.misc.paymentTermId = netThirty.id;

  // ── Customer status ids ───────────────────────────────────────────────────
  const statuses = await rows<{ id: string; name: string }>(
    client,
    `SELECT id, name FROM "customerStatus" WHERE "companyId" = $1`,
    [companyId]
  );
  for (const s of statuses) ctx.refs.misc[`cstatus:${s.name}`] = s.id;

  // ── Customers ─────────────────────────────────────────────────────────────
  ctx.log("customers");
  for (const c of data.customers) {
    const statusId = need(
      ctx.refs.misc,
      `cstatus:${c.status}`,
      "customer status"
    );
    const typeId = need(ctx.refs.misc, `ctype:${c.type}`, "customer type");
    const custId = await insertId(ctx, "customer", {
      name: c.name,
      customerTypeId: typeId,
      customerStatusId: statusId,
      phone: c.phone,
      website: c.website,
      currencyCode: "USD"
    });
    ctx.refs.customers[c.name] = custId;

    // Interceptor created customerPayment/Shipping/Tax — just update payment term
    await client.query(
      `UPDATE "customerPayment" SET "paymentTermId" = $1 WHERE "customerId" = $2`,
      [netThirty.id, custId]
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
      currencyCode: "USD"
    });
    ctx.refs.suppliers[s.name] = supId;

    await client.query(
      `UPDATE "supplierPayment" SET "paymentTermId" = $1 WHERE "supplierId" = $2`,
      [netThirty.id, supId]
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
      currencyCode: "USD"
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
  // second version is what gives a procedure a readable history. Every version
  // seeds as Draft so a demo company can edit its steps without a new version.
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
    await insertId(ctx, "noQuoteReason", { name });
  }
}
