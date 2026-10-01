// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Company } from "../../../types";
import type { LabelData } from "./types";

/** Merge-field variable map for a tracking label. */
export function buildLabelVars(
  item: Pick<LabelData, "item">["item"],
  company?: Company | null
): Record<string, string> {
  const str = (v: unknown): string => (v == null ? "" : String(v));
  return {
    "item.id": str(item?.itemId),
    "item.revision": str(item?.revision),
    "label.quantity": str(item?.quantity),
    "label.trackingType": str(item?.trackingType),
    "label.number": str(item?.number),
    "label.trackedEntityId": str(item?.trackedEntityId),
    "company.name": str(company?.name),
    "company.city": str(company?.city),
    "company.country": str(company?.countryCode)
  };
}
