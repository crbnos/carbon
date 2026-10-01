// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";

type ExchangeRateSourceBadgeProps = {
  source: string | null | undefined;
};

const ExchangeRateSourceBadge = ({ source }: ExchangeRateSourceBadgeProps) => {
  const { t } = useLingui();

  switch (source) {
    case "base":
      return <Badge variant="secondary">{t`Base currency`}</Badge>;
    case "override":
      return <Badge variant="blue">{t`Your rate`}</Badge>;
    case "market":
      return <Badge variant="green">{t`Market rate`}</Badge>;
    case "missing":
      return <Badge variant="red">{t`No rate`}</Badge>;
    default:
      return null;
  }
};

export default ExchangeRateSourceBadge;
