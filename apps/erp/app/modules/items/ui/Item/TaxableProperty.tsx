// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Boolean } from "~/components/Form";

type TaxablePropertyProps = {
  itemId?: string;
  // Undefined while the route has no item row: renders nothing.
  taxable?: boolean;
  onChange: (value: "on" | "off") => void;
  isReadOnly?: boolean;
};

/**
 * The item's "Taxable" switch, shared by every item type's Properties panel.
 */
export function TaxableProperty({
  itemId,
  taxable,
  onChange,
  isReadOnly
}: TaxablePropertyProps) {
  const { t } = useLingui();
  if (taxable === undefined) return null;

  return (
    <ValidatedForm
      key={itemId}
      defaultValues={{ taxable }}
      validator={z.object({ taxable: zfd.checkbox() })}
      className="w-full"
      isReadOnly={isReadOnly}
    >
      <Boolean
        label={t`Taxable`}
        name="taxable"
        variant="small"
        onChange={(value) => onChange(value ? "on" : "off")}
      />
    </ValidatedForm>
  );
}
