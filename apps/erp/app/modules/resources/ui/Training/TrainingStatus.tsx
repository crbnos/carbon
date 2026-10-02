// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import type { trainingStatus } from "~/modules/resources";

type TrainingStatusProps = {
  status: (typeof trainingStatus)[number] | null;
};

export default function TrainingStatus({ status }: TrainingStatusProps) {
  switch (status) {
    case "Draft":
      return <Status color="gray">Draft</Status>;
    case "Active":
      return <Status color="green">Active</Status>;
    case "Archived":
      return <Status color="red">Archived</Status>;
    default:
      return null;
  }
}
