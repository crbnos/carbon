// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { useFirstArticleLabels } from "./useFirstArticleLabels";

type FirstArticleStatusValue =
  Database["public"]["Enums"]["firstArticleInspectionStatus"];

const COLORS: Record<FirstArticleStatusValue, "gray" | "yellow" | "green"> = {
  Draft: "gray",
  Verified: "yellow",
  Approved: "green"
};

const FirstArticleStatus = ({
  status
}: {
  status?: FirstArticleStatusValue | null;
}) => {
  const labels = useFirstArticleLabels();
  if (!status) return null;
  return <Status color={COLORS[status]}>{labels.status(status)}</Status>;
};

export default FirstArticleStatus;
