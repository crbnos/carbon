import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import type { getWarrantyTermsList } from "~/modules/sales";
import { path } from "~/utils/path";

type WarrantyTermSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

// Inline (properties-panel) rendering shows the term's name rather than its id.
const WarrantyTermPreview = (
  value: string,
  options: { value: string; label: React.ReactNode }[]
) => {
  const term = options.find((option) => option.value === value);
  return term ? <>{term.label}</> : null;
};

const WarrantyTerm = (props: WarrantyTermSelectProps) => {
  const { t } = useLingui();
  const options = useWarrantyTerms();

  return (
    <Combobox
      options={options.map((option) => ({
        value: option.value,
        label: <Enumerable value={option.label} />
      }))}
      {...props}
      inline={props.inline ? WarrantyTermPreview : undefined}
      label={props?.label ?? t`Warranty Term`}
    />
  );
};

WarrantyTerm.displayName = "WarrantyTerm";

export default WarrantyTerm;

export const useWarrantyTerms = () => {
  const warrantyTermFetcher =
    useFetcher<Awaited<ReturnType<typeof getWarrantyTermsList>>>();

  useMount(() => {
    warrantyTermFetcher.load(path.to.api.warrantyTerms);
  });

  return useMemo(
    () =>
      (warrantyTermFetcher.data?.data ?? []).map((term) => ({
        value: term.id,
        label: term.name
      })),
    [warrantyTermFetcher.data?.data]
  );
};
