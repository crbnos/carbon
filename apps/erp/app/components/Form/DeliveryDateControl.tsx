// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { deliveryDateControlTypes } from "~/modules/shared/shared.models";

type DeliveryDateControlValue = (typeof deliveryDateControlTypes)[number];

/** The delivery date check: Settings → Sales and an item's Planning tab. */
const DeliveryDateControl = (props: Omit<SelectProps, "options">) => {
  const { t } = useLingui();
  // A Record, so a check added to the enum fails the typecheck until labelled.
  const checks: Record<
    DeliveryDateControlValue,
    { label: string; helper: string }
  > = {
    None: {
      label: t`None`,
      helper: t`Any promised date saves without a warning.`
    },
    "Lead Time": {
      label: t`Lead Time`,
      helper: t`Compares the date with the item's lead time, BOM included.`
    },
    Stock: {
      label: t`Stock`,
      helper: t`Checks free stock week by week, then the lead time.`
    },
    Capacity: {
      label: t`Capacity`,
      helper: t`Checks free stock, then the shop's schedule for made items.`
    }
  };
  // The helper sits under the option's name in the list; the field shows the name only.
  const options = deliveryDateControlTypes.map((value) => ({
    value,
    ...checks[value]
  }));

  return <Select termId="delivery-date-check" {...props} options={options} />;
};

export default DeliveryDateControl;
