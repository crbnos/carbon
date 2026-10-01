// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import type { supplierStatusType } from "~/modules/purchasing";

type SupplierStatusIndicatorProps = {
  status?: (typeof supplierStatusType)[number] | null;
};

const colorMap: Record<
  (typeof supplierStatusType)[number],
  "green" | "gray" | "orange" | "red"
> = {
  Active: "green",
  Inactive: "gray",
  Pending: "orange",
  Rejected: "red"
};

const SupplierStatusIndicator = ({ status }: SupplierStatusIndicatorProps) => {
  if (!status) return null;
  return <Status color={colorMap[status]}>{status}</Status>;
};

export { SupplierStatusIndicator };
