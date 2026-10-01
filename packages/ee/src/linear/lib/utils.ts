// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";

export enum LinearWorkStateType {
  Triage = "triage",
  Backlog = "backlog",
  Todo = "todo",
  Unstarted = "unstarted",
  Started = "started",
  Completed = "completed",
  Canceled = "canceled"
}

type CarbonTaskStatus = Database["public"]["Enums"]["nonConformanceTaskStatus"];

export const mapLinearStatusToCarbonStatus = (
  status: LinearWorkStateType
): CarbonTaskStatus => {
  switch (status) {
    case LinearWorkStateType.Started:
      return "In Progress";
    case LinearWorkStateType.Canceled:
      return "Skipped";
    case LinearWorkStateType.Completed:
      return "Completed";
    case LinearWorkStateType.Triage:
    case LinearWorkStateType.Unstarted:
    case LinearWorkStateType.Todo:
    case LinearWorkStateType.Backlog:
    default:
      return "Pending";
  }
};

export const mapCarbonStatusToLinearStatus = (
  status: string
): LinearWorkStateType => {
  switch (status) {
    case "Pending":
      return LinearWorkStateType.Unstarted;
    case "In Progress":
      return LinearWorkStateType.Started;
    case "Completed":
      return LinearWorkStateType.Completed;
    case "Skipped":
      return LinearWorkStateType.Canceled;
    default:
      throw new Error(`Unknown Carbon task status: ${status}`);
  }
};
