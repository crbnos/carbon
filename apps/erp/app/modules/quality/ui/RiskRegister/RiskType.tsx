// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type RiskTypeProps = {
  type?: Database["public"]["Enums"]["riskRegisterType"] | null;
};

const RiskType = ({ type }: RiskTypeProps) => {
  switch (type) {
    case "Risk":
      return <Status color="red">{type}</Status>;
    case "Opportunity":
      return <Status color="green">{type}</Status>;

    default:
      return null;
  }
};

export default RiskType;
