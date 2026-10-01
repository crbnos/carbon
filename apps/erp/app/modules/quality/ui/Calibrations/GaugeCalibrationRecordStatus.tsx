// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type GaugeCalibrationRecordStatusProps = {
  status?: Database["public"]["Enums"]["inspectionStatus"] | null;
};

const GaugeCalibrationRecordStatus = ({
  status
}: GaugeCalibrationRecordStatusProps) => {
  switch (status) {
    case "Pass":
      return <Status color="green">{status}</Status>;
    case "Fail":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export { GaugeCalibrationRecordStatus };
