// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";

export function getInspectionStatusVariant(status: string) {
  if (status === "Passed") return "green";
  if (status === "Failed") return "red";
  if (status === "Partial") return "yellow";
  if (status === "In Progress") return "blue";
  // A cancelled manual lot, or the lot of a voided receipt.
  if (status === "Cancelled") return "gray";
  return "secondary";
}

export function useInspectionLotStatusLabel(
  status: string | undefined
): string {
  const { t } = useLingui();
  switch (status) {
    case "Pending":
      return t`Pending`;
    case "In Progress":
      return t`In Progress`;
    case "Passed":
      return t`Passed`;
    case "Failed":
      return t`Failed`;
    case "Partial":
      return t`Partial`;
    case "Cancelled":
      return t`Cancelled`;
    default:
      return status ?? "";
  }
}

type InspectionStatusProps = {
  status?: string | null;
};

export function InspectionStatus({ status }: InspectionStatusProps) {
  const label = useInspectionLotStatusLabel(status ?? undefined);
  if (!status) return null;
  return <Badge variant={getInspectionStatusVariant(status)}>{label}</Badge>;
}
