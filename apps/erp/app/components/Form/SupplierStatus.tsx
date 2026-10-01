// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { supplierStatusType } from "~/modules/purchasing";
import { SupplierStatusIndicator } from "~/modules/purchasing/ui/Supplier/SupplierStatusIndicator";

type SupplierStatusSelectProps = Omit<ComboboxProps, "options">;

const SupplierStatus = (props: SupplierStatusSelectProps) => {
  const options = supplierStatusType.map((status) => ({
    value: status,
    label: <SupplierStatusIndicator status={status} />
  }));

  return (
    <Combobox
      options={options}
      {...props}
      label={props?.label ?? "Supplier Status"}
    />
  );
};

SupplierStatus.displayName = "SupplierStatus";

export default SupplierStatus;
