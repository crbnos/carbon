// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import RiskRegisterCard from "~/modules/quality/ui/RiskRegister/RiskRegisterCard";

type QuoteLineRiskRegisterProps = {
  quoteLineId: string;
  itemId: string;
};

export default function QuoteLineRiskRegister({
  quoteLineId,
  itemId
}: QuoteLineRiskRegisterProps) {
  return (
    <RiskRegisterCard
      sourceId={quoteLineId}
      source="Quote Line"
      itemId={itemId}
    />
  );
}
