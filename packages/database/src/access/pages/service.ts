// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const LABEL = "Service";

export const PAGES = [
  {
    id: "service.jobs",
    label: "Jobs",
    maxLevel: "Full",
    tables: [
      "serviceJob",
      "serviceJobEstimateLine",
      "serviceJobItem",
      "serviceJobTime"
    ],
    // The service job list is the module's root.
    paths: ["/x/service-jobs", "/x/service-job/"]
  },
  {
    // The dispatch grid assigns technicians to jobs.
    id: "service.schedule",
    label: "Schedule",
    maxLevel: "Full",
    tables: ["serviceJobAssignment"],
    paths: ["/x/service-jobs/schedule"]
  },
  {
    id: "service.customerAssets",
    label: "Customer Assets",
    maxLevel: "Full",
    tables: ["customerAsset"],
    paths: [
      "/x/service-jobs/assets",
      "/x/customer-asset/",
      "/x/customer/$customerId/assets"
    ]
  }
] as const satisfies readonly Page[];
