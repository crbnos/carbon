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
  const labels: Record<DeliveryDateControlValue, string> = {
    None: t`None`,
    "Lead Time": t`Lead Time`,
    Stock: t`Stock`,
    Capacity: t`Capacity`
  };
  const options = deliveryDateControlTypes.map((value) => ({
    value,
    label: labels[value]
  }));

  return <Select termId="delivery-date-check" {...props} options={options} />;
};

export default DeliveryDateControl;
