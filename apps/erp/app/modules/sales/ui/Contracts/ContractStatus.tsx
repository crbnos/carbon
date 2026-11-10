// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { CUSTOMER_CONTRACT_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ContractStatusType } from "./types";

type ContractStatusProps = {
  status?: ContractStatusType | null;
};

const ContractStatus = ({ status }: ContractStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;

  const color = CUSTOMER_CONTRACT_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const labels: Record<ContractStatusType, string> = {
    Draft: t`Draft`,
    Active: t`Active`,
    Ended: t`Ended`
  };

  return <Status color={color}>{labels[status] ?? status}</Status>;
};

export default ContractStatus;
