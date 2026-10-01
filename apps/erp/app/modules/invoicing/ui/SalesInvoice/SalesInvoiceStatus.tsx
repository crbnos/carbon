// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { SALES_INVOICE_STATUS_COLOR_MAP } from "@carbon/utils";

type SalesInvoicingStatusProps = {
  status?: string | null;
};

const SalesInvoicingStatus = ({ status }: SalesInvoicingStatusProps) => {
  if (!status) return null;
  const color =
    SALES_INVOICE_STATUS_COLOR_MAP[
      status as Database["public"]["Enums"]["salesInvoiceStatus"]
    ];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default SalesInvoicingStatus;
