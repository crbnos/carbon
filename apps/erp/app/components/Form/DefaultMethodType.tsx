// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { SelectControlled } from "@carbon/form";
import { Trans } from "@lingui/macro";
import { getValidMethodTypes } from "~/modules/shared/shared.models";
import { MethodIcon } from "../Icons";

export type DefaultMethodTypeSelectProps = Omit<SelectProps, "options"> & {
  replenishmentSystem: string;
};

const DefaultMethodType = ({
  replenishmentSystem,
  ...props
}: DefaultMethodTypeSelectProps) => {
  const options = getValidMethodTypes(replenishmentSystem).map((t) => ({
    value: t,
    label: (
      <span className="flex items-center gap-2">
        <MethodIcon type={t} />
        {t === "Purchase to Order" ? (
          <Trans>Purchase to Order</Trans>
        ) : t === "Pull from Inventory" ? (
          <Trans>Pull from Inventory</Trans>
        ) : t === "Make to Order" ? (
          <Trans>Make to Order</Trans>
        ) : (
          t
        )}
      </span>
    )
  }));

  return <SelectControlled {...props} options={options} />;
};

export default DefaultMethodType;
