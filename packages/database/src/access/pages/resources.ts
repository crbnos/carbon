// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const RESOURCES_PAGES = [
  {
    id: "resources.dispatches",
    label: "Dispatches",
    maxLevel: "Full",
    tables: [
      "maintenanceDispatch",
      "maintenanceDispatchEvent",
      "maintenanceDispatchItem",
      "maintenanceDispatchItemTrackedEntity",
      "maintenanceDispatchWorkCenter"
    ],
    paths: ["/x/resources/maintenance", "/x/maintenance/"]
  },
  {
    id: "resources.schedules",
    label: "Schedules",
    maxLevel: "Full",
    tables: ["maintenanceSchedule", "maintenanceScheduleItem"],
    paths: ["/x/resources/scheduled-maintenance"]
  },
  {
    id: "resources.failureModes",
    label: "Failure Modes",
    maxLevel: "Full",
    tables: ["maintenanceFailureMode"],
    paths: ["/x/resources/failure-modes"]
  },
  {
    id: "resources.locations",
    label: "Locations",
    maxLevel: "Full",
    tables: ["location"],
    paths: ["/x/resources/locations"]
  },
  {
    id: "resources.processes",
    label: "Processes",
    maxLevel: "Full",
    tables: ["process", "supplierProcess"],
    paths: ["/x/resources/processes"]
  },
  {
    id: "resources.workCenters",
    label: "Work Centers",
    maxLevel: "Full",
    tables: [
      "workCenter",
      "workCenterProcess",
      "workCenterReplacementPart",
      "workCenterShift"
    ],
    paths: ["/x/resources/work-centers"]
  },
  {
    id: "resources.abilities",
    label: "Abilities",
    maxLevel: "Full",
    tables: [
      "ability",
      "employeeAbility",
      "contractor",
      "contractorAbility",
      "partner"
    ],
    paths: [
      "/x/resources/abilities",
      "/x/resources/ability/",
      "/x/resources/person/",
      "/x/resources/contractors",
      "/x/resources/partners"
    ]
  },
  {
    id: "resources.training",
    label: "Training",
    maxLevel: "Full",
    tables: ["training", "trainingQuestion"],
    paths: ["/x/resources/training", "/x/training/"]
  },
  {
    id: "resources.assignments",
    label: "Assignments",
    maxLevel: "Full",
    tables: ["trainingAssignment", "trainingCompletion"],
    paths: ["/x/resources/assignments"]
  },
  {
    id: "resources.suggestions",
    label: "Suggestions",
    maxLevel: "Full",
    tables: ["suggestion"],
    paths: ["/x/resources/suggestions"]
  }
] as const satisfies readonly Page[];
