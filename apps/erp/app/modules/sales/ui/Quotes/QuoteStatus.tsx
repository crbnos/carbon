// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { QUOTE_STATUS_COLOR_MAP } from "@carbon/utils";
import type { quoteStatusType } from "../../sales.models";

type QuoteStatusProps = {
  status?: (typeof quoteStatusType)[number] | null;
};

const QuoteStatus = ({ status }: QuoteStatusProps) => {
  if (!status) return null;

  const color = QUOTE_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default QuoteStatus;
