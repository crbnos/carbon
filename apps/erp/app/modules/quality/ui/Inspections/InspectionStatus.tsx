// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";

export function getInspectionStatusVariant(status: string) {
  if (status === "Passed") return "green";
  if (status === "Failed") return "red";
  if (status === "Partial") return "yellow";
  if (status === "In Progress") return "blue";
  return "secondary";
}

type InspectionStatusProps = {
  status?: string | null;
};

export function InspectionStatus({ status }: InspectionStatusProps) {
  if (!status) return null;
  return <Badge variant={getInspectionStatusVariant(status)}>{status}</Badge>;
}
