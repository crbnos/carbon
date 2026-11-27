// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, useControlField } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
import { usePercentFormatter } from "~/hooks";
import type { getTaxCodesList } from "~/modules/accounting/accounting.service";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type TaxCodeListItem = NonNullable<
  Awaited<ReturnType<typeof getTaxCodesList>>["data"]
>[number] & {
  /** Effective rate today, as a 0..1 fraction. */
  rate: number;
};

type TaxCodeSelectProps = Omit<
  ComboboxProps,
  "options" | "inline" | "onChange"
> & {
  inline?: boolean;
  onChange?: (option: { value: string; rate: number } | null) => void;
};

const TaxCodePreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
) => {
  const taxCode = options.find((o) => o.value === value);
  if (!taxCode) return null;
  return <span>{taxCode.label}</span>;
};

const TaxCode = ({ onChange, ...props }: TaxCodeSelectProps) => {
  const [fieldValue] = useControlField<string | undefined>(props.name);
  // A retired code leaves the list, but one the record already names stays.
  const options = useTaxCodes(props.value ?? fieldValue);

  // A tax code needs components, so there is no inline create: the empty
  // state links to the new tax code page.
  const emptyMessage = useEmptyState("taxCode");

  return (
    <Combobox
      options={options}
      emptyMessage={emptyMessage}
      {...props}
      inline={props.inline ? TaxCodePreview : undefined}
      label={props?.label ?? "Tax Code"}
      onChange={(newValue) => {
        if (!onChange) return;
        const option = newValue
          ? options.find((o) => o.value === newValue.value)
          : undefined;
        onChange(option ? { value: option.value, rate: option.rate } : null);
      }}
    />
  );
};

TaxCode.displayName = "TaxCode";

export default TaxCode;

/** The active codes, plus `keepId` when it names a retired one. */
export const useTaxCodes = (keepId?: string | null) => {
  const formatter = usePercentFormatter();
  const taxCodeFetcher = useLoaderQuery<{ data: TaxCodeListItem[] | null }>(
    path.to.api.taxCodes
  );

  const options = useMemo(() => {
    return (taxCodeFetcher.data?.data ?? [])
      .filter((c) => c.active || c.id === keepId)
      .map((c) => ({
        value: c.id,
        label: c.name,
        helper: formatter.format(c.rate),
        rate: c.rate
      }));
  }, [taxCodeFetcher.data?.data, formatter, keepId]);

  return options;
};
