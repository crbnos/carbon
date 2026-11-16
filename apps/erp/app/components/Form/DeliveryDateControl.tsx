// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { Trans, useLingui } from "@lingui/react/macro";
import { deliveryDateControlTypes } from "~/modules/shared/shared.models";

type DeliveryDateControlValue = (typeof deliveryDateControlTypes)[number];

type Check = { label: string; description: string };

function DeliveryDateCheckHelp({ checks }: { checks: Check[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p>
        <Trans>Each check adds to the one above it.</Trans>
      </p>
      <div className="flex flex-col gap-1.5">
        {checks.map((check) => (
          <div key={check.label} className="flex flex-col leading-tight">
            <span className="font-medium text-foreground">{check.label}</span>
            <span>{check.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The delivery date check: Settings → Sales and an item's Planning tab. */
const DeliveryDateControl = (props: Omit<SelectProps, "options">) => {
  const { t } = useLingui();
  // A Record, so a check added to the enum fails the typecheck until labelled.
  const checks: Record<DeliveryDateControlValue, Check> = {
    None: {
      label: t`None`,
      description: t`No check. Any promised date saves without a warning.`
    },
    "Lead Time": {
      label: t`Lead Time`,
      description: t`Warns when the date is sooner than the item's lead time through its BOM.`
    },
    Stock: {
      label: t`Stock`,
      description: t`Checks free stock by week, then the lead time.`
    },
    Capacity: {
      label: t`Capacity`,
      description: t`Checks free stock, then simulates the shop's schedule for a made item.`
    }
  };
  const options = deliveryDateControlTypes.map((value) => ({
    value,
    label: checks[value].label
  }));

  return (
    <Select
      helpText={
        <DeliveryDateCheckHelp
          checks={deliveryDateControlTypes.map((value) => checks[value])}
        />
      }
      {...props}
      options={options}
    />
  );
};

export default DeliveryDateControl;
