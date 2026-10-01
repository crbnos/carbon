// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { SALES_RFQ_STATUS_COLOR_MAP } from "@carbon/utils";
import type { salesRFQStatusType } from "../../sales.models";

type SalesRFQStatusProps = {
  status?: (typeof salesRFQStatusType)[number] | null;
};

const SalesRFQStatus = ({ status }: SalesRFQStatusProps) => {
  if (!status) return null;

  const color = SALES_RFQ_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default SalesRFQStatus;
