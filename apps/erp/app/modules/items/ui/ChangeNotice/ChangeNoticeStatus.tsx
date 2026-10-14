// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { CHANGE_ORDER_STATUS_COLOR_MAP } from "@carbon/utils";
import type { ChangeNoticeStatus as ChangeNoticeStatusType } from "../../types";

type ChangeNoticeStatusProps = {
  status?: ChangeNoticeStatusType | null;
};

const ChangeNoticeStatus = ({ status }: ChangeNoticeStatusProps) => {
  if (!status) return null;
  const color = CHANGE_ORDER_STATUS_COLOR_MAP[status];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default ChangeNoticeStatus;
