// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import RiskRegisterCard from "~/modules/quality/ui/RiskRegister/RiskRegisterCard";

type ItemRiskRegisterProps = {
  itemId: string;
};

export default function ItemRiskRegister({ itemId }: ItemRiskRegisterProps) {
  return <RiskRegisterCard sourceId={itemId} source="Item" itemId={itemId} />;
}
