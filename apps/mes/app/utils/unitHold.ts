// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A unit on hold for an open quality issue, as the server reads it
// (`readUnitHolds`) and as the screens show it. Shared by both, so the rule
// "a unit on hold is not open here" is one function.

import type { Database } from "@carbon/database";

/** An open issue linked to a unit. */
export type HoldingIssue = {
  id: string;
  /** The issue number the operator and quality both see. */
  readableId: string;
  name: string;
  description: string | null;
  /** The issue type's name. */
  type: string | null;
  status: Database["public"]["Enums"]["nonConformanceStatus"];
  createdAt: string;
};

/** The open issues that hold each unit, oldest first, keyed by unit id. */
export type UnitHolds = Record<string, HoldingIssue[]>;

/** The issues that hold `unitId`; empty when it is not on hold. */
export function holdingIssues(
  holds: UnitHolds | null | undefined,
  unitId: string | null | undefined
): HoldingIssue[] {
  return (unitId ? holds?.[unitId] : undefined) ?? [];
}

export function isUnitOnHold(
  holds: UnitHolds | null | undefined,
  unitId: string | null | undefined
): boolean {
  return holdingIssues(holds, unitId).length > 0;
}

/** The server's refusal of work on a unit on hold. Names every issue. */
export function unitOnHoldMessage(issues: HoldingIssue[]): string {
  const numbers = issues.map((issue) => issue.readableId).join(", ");
  return issues.length > 1
    ? `This unit is on hold for issues ${numbers}`
    : `This unit is on hold for issue ${numbers}`;
}
