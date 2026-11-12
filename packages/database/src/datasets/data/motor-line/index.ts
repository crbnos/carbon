// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Dataset } from "../../types.ts";
import { motorAccounting } from "../motor/accounting.ts";
import {
  COST_CENTERS,
  CUSTOMER_TYPES,
  EMPLOYEE_JOB,
  HOLIDAYS,
  ITEM_POSTING_GROUPS,
  MATERIAL_TAXONOMY,
  NO_QUOTE_REASONS,
  PLANT,
  PRINTER_ROUTE,
  SHIFTS,
  SHIPPING_METHODS,
  SHIPPING_TERMS,
  STORAGE_TYPES,
  SUPPLIER_CONTACTS,
  SUPPLIER_TYPES,
  SUPPLIERS,
  TAGS
} from "../motor/foundation.ts";
import { motorSales } from "../motor/sales.ts";
import {
  AJ3_BATCH_PROPERTIES,
  AJ3_BUY_PARTS,
  AJ3_KANBAN_ITEMS,
  AJ3_MAKE_PARTS,
  AJ3_METHODS,
  AJ3_ON_HAND_TRACKED,
  AJ3_OPENING_STOCK,
  AJ3_PROCESSES,
  AJ3_SERIAL_SEQUENCES,
  AJ3_SHELVES,
  AJ3_SUPPLIER_PARTS,
  AJ3_WAREHOUSES,
  AJ3_WORK_CENTER_PROCESS_LINKS,
  AJ3_WORK_CENTER_SHIFTS,
  AJ3_WORK_CENTERS
} from "./aj3.ts";

// The suppliers the AJ-3 supplier parts name.
const AJ3_SUPPLIERS = new Set(AJ3_SUPPLIER_PARTS.map((link) => link.supplier));

/**
 * Dev only: a walkthrough of the AJ-3 serial motor line and nothing else. It
 * keeps the motor company setup (plant, units, shift, printer, the AJ-3
 * suppliers) and seeds no documents: no jobs, orders or demand. Chambers and
 * injectors are on the shelf as serials, so after MRP the one Make suggestion
 * is the engine (one is forecast next week). No industryId, so onboarding never
 * offers it.
 */
export const motorLine: Dataset = {
  key: "motor-line",
  label: "Motor line (dev)",
  industryId: null,
  walkthrough: true,
  // Reuse the motor thumbnails; null industryId keeps onboarding off it.
  assetIndustryId: "automotive_precision",
  foundation: {
    departments: ["Assembly"],
    abilities: ["Precision Assembly"],
    processes: AJ3_PROCESSES,
    workCenters: AJ3_WORK_CENTERS,
    hqWorkCenter: {
      name: "Engineering Bench",
      dept: "Assembly",
      ability: "Precision Assembly",
      laborRate: 60,
      machineRate: 0
    },
    customers: [],
    customerContacts: [],
    suppliers: SUPPLIERS.filter((s) => AJ3_SUPPLIERS.has(s.name)),
    supplierContacts: SUPPLIER_CONTACTS.filter((c) =>
      AJ3_SUPPLIERS.has(c.supplier)
    ),
    supplierProcesses: [],
    procedures: [],
    shippingMethods: SHIPPING_METHODS,
    shippingTerms: SHIPPING_TERMS,
    itemPostingGroups: ITEM_POSTING_GROUPS,
    workCenterProcessLinks: AJ3_WORK_CENTER_PROCESS_LINKS,
    customerTypes: CUSTOMER_TYPES,
    supplierTypes: SUPPLIER_TYPES,
    costCenters: COST_CENTERS,
    noQuoteReasons: NO_QUOTE_REASONS,
    contractors: [],
    partners: [],
    plant: PLANT,
    shifts: SHIFTS.filter((shift) => shift.name === "A Shift"),
    workCenterShifts: AJ3_WORK_CENTER_SHIFTS,
    employeeJob: EMPLOYEE_JOB,
    warehouses: [
      ...AJ3_WAREHOUSES,
      { key: "QC", name: "Incoming Inspection Hold", requiresBin: true }
    ],
    storageTypes: STORAGE_TYPES,
    nonNettableStorageTypes: ["Quarantine"],
    shelves: [
      ...AJ3_SHELVES,
      { name: "QC-Inspection", warehouse: "QC", storageType: "Quarantine" },
      { name: "MRB-Hold", warehouse: "QC", storageType: "Quarantine" }
    ],
    inspectionShelf: "QC-Inspection",
    rejectedShelf: "MRB-Hold",
    // The plant default, so the traveler at the pick and the engine's serial
    // label at F6 both reach the printer.
    printerRoute: { ...PRINTER_ROUTE, plantDefault: true },
    holidays: HOLIDAYS,
    tags: TAGS,
    materialTaxonomy: MATERIAL_TAXONOMY,
    defaultShippingMethod: "UPS Ground",
    contractorAgency: null,
    partyAddressCity: "Fort Wayne",
    partyAddressStateProvince: "IN",
    partyAddressPostalCode: "46803",
    partyAddressCountryCode: "US",
    lineFlow: {
      travelerLabels: true,
      requireTrackedMaterialsIssued: true,
      autoPickingListOnRelease: true
    }
  },
  items: {
    buyParts: AJ3_BUY_PARTS,
    materials: [],
    consumables: [],
    tools: [],
    services: [],
    makeParts: AJ3_MAKE_PARTS,
    methods: AJ3_METHODS,
    supplierLinks: AJ3_SUPPLIER_PARTS,
    supersessions: [],
    customerParts: [],
    priceOverrides: [],
    pricingRules: [],
    configuration: null,
    revisionLadder: [],
    inspectionPlans: [],
    enforcementRules: [],
    batchProperties: AJ3_BATCH_PROPERTIES
  },
  inventory: {
    openingStock: AJ3_OPENING_STOCK,
    onHandTracked: AJ3_ON_HAND_TRACKED,
    kanbanItems: AJ3_KANBAN_ITEMS,
    inventoryCounts: [],
    shelfLives: [],
    stockTransfers: [],
    warehouseTransfers: []
  },
  sales: {
    opportunities: [],
    statusOrders: [],
    releasedOrders: [],
    salesReturns: [],
    contracts: [],
    customerPortals: [],
    customerBankAccounts: [],
    customerAssets: [],
    serviceLaborRates: motorSales.serviceLaborRates,
    serviceJobs: [],
    rentalAgreements: []
  },
  purchasing: {
    rfqQuantityBreaks: [],
    rfqLines: [],
    rfqQuotes: [],
    rfqWinningQuote: "",
    rfqOrderQuantity: 0,
    rfqHeader: null,
    lifecycleRfqs: [],
    purchaseOrders: [],
    standaloneSupplierQuotes: [],
    purchaseReturns: [],
    approvalRules: [],
    approvalRequests: [],
    supplierBankAccounts: []
  },
  production: {
    jobs: [],
    shifts: [],
    genealogyInputs: [],
    genealogyAssembly: null,
    eventsJobKey: null,
    genealogyJobKey: null,
    openEvent: null,
    batch: null,
    rework: null,
    pickingLists: [],
    materialRequests: []
  },
  quality: {
    workflows: [],
    nonConformances: [],
    inspections: [],
    qualityDocuments: [],
    gauges: [],
    risks: []
  },
  changeOrders: { changeOrders: [] },
  accounting: {
    fixedAssets: [],
    journalEntries: [],
    payments: [],
    memos: [],
    projects: [],
    indirectPools: [],
    laborCategories: [],
    timesheetEntries: [],
    customDimension: motorAccounting.customDimension,
    closeTasks: [],
    exchangeRateOverrides: [],
    billingAddresses: motorAccounting.billingAddresses
  },
  ops: {
    userAttributeCategories: [],
    customFields: [],
    serialSequences: AJ3_SERIAL_SEQUENCES,
    printJobs: [],
    maintenanceSchedules: [],
    maintenanceDispatches: [],
    replacementParts: [],
    trainings: [],
    timecards: [],
    peopleAssignments: [],
    peopleAbsences: [],
    suggestions: [],
    notes: []
  },
  workflows: { build: () => [], runs: [] },
  planning: {
    buyItemIds: [],
    makeItemIds: [],
    // One engine forecast next week is the only demand. MRP's grid lists an
    // item with demand, open supply or a reorder point; a safety stock alone
    // does not put it there. Chambers and injectors cover it from the shelf.
    demandProjections: [{ readableId: "AJ3-ENG", quantities: [0, 1] }],
    demandOrder: null,
    hq: { reorderItemIds: [], demandProjections: [] }
  }
};
