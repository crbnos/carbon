// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const PRODUCTION_PAGES = [
  {
    id: "production.jobs",
    label: "Jobs",
    maxLevel: "Full",
    tables: [
      "job",
      "jobMakeMethod",
      "jobMaterial",
      "jobMaterialStep",
      "jobOperation",
      "jobOperationNote",
      "jobOperationParameter",
      "jobOperationStep",
      "jobOperationStepRecord",
      "jobOperationStepSlide",
      "jobOperationTool",
      "jobOperationToolStep",
      "productionEvent",
      "productionQuantity",
      "rework",
      "capacityReservation"
    ],
    readers: ["ability"],
    paths: ["/x/production/jobs", "/x/job/"]
  },
  {
    id: "production.batches",
    label: "Batches",
    maxLevel: "Full",
    tables: ["jobOperationBatch"],
    paths: ["/x/production/batches"]
  },
  {
    id: "production.unattributedTime",
    label: "Unattributed Time",
    maxLevel: "Full",
    tables: [],
    paths: ["/x/production/machine-time"]
  },
  {
    id: "production.demandForecasts",
    label: "Demand Forecasts",
    maxLevel: "Full",
    tables: ["demandProjection"],
    paths: ["/x/production/demand-forecasts"]
  },
  {
    id: "production.materialPlanning",
    label: "Material Planning",
    maxLevel: "Full",
    tables: [
      "planningAction",
      "demandForecast",
      "demandForecastSource",
      "supplyForecast",
      "demandActual",
      "supplyActual"
    ],
    paths: ["/x/production/planning"]
  },
  {
    id: "production.resourcePlanning",
    label: "Resource Planning",
    maxLevel: "Full",
    tables: ["peopleAssignment", "peopleAbsence"],
    paths: ["/x/priority/people"]
  },
  {
    id: "production.forecast",
    label: "Forecast",
    maxLevel: "View",
    tables: [],
    paths: ["/x/scheduling/forecast"]
  },
  {
    id: "production.priorities",
    label: "Priorities",
    maxLevel: "Full",
    tables: [],
    paths: [
      "/x/priority/dates",
      "/x/priority/operations",
      "/x/priority/batching"
    ]
  },
  {
    id: "production.outbound",
    label: "Outbound",
    maxLevel: "View",
    tables: [],
    paths: ["/x/scheduling/outbound"]
  },
  {
    id: "production.assemblies",
    label: "Assemblies",
    maxLevel: "Full",
    tables: [
      "assemblyInstruction",
      "assemblyInstructionStep",
      "assemblyInstructionStepMaterial",
      "assemblyInstructionStepSlide",
      "assemblyInstructionStepTool",
      "assemblyComponentMapping",
      "assemblyPlanJob",
      "assemblyUnit"
    ],
    paths: ["/x/production/assemblies", "/x/assembly/"]
  },
  {
    id: "production.procedures",
    label: "Procedures",
    maxLevel: "Full",
    tables: ["procedure", "procedureParameter", "procedureStep"],
    paths: ["/x/production/procedures", "/x/procedure/"]
  },
  {
    id: "production.scrapReasons",
    label: "Scrap Reasons",
    maxLevel: "Full",
    tables: ["scrapReason"],
    paths: ["/x/production/scrap-reasons"]
  }
] as const satisfies readonly Page[];
