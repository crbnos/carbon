// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { dimensionEntityTypes } from "../../accounting.models";

type DimensionEntityType = (typeof dimensionEntityTypes)[number];

export const dimensionEntityTypeLabels: Record<
  DimensionEntityType,
  MessageDescriptor
> = {
  CostCenter: msg`Cost Center`,
  Custom: msg`Custom`,
  Customer: msg`Customer`,
  CustomerType: msg`Customer Type`,
  Department: msg`Department`,
  Employee: msg`Employee`,
  FixedAssetClass: msg`Asset Class`,
  Item: msg`Item`,
  ItemPostingGroup: msg`Item Group`,
  Location: msg`Location`,
  Process: msg`Process`,
  Project: msg`Project`,
  ProjectElement: msg`Project Element`,
  ScrapReason: msg`Scrap Reason`,
  Supplier: msg`Supplier`,
  SupplierType: msg`Supplier Type`,
  WorkCenter: msg`Work Center`
};
