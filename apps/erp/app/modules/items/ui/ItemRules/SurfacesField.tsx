import { useControlField, useField } from "@carbon/form";
import {
  ChoiceSelect,
  type ChoiceSelectOption,
  FormControl,
  FormErrorMessage,
  FormLabel
} from "@carbon/react";
import { TRANSACTION_SURFACES, type TransactionSurface } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import {
  LuArrowRightLeft,
  LuPackage,
  LuScale,
  LuTruck,
  LuWarehouse
} from "react-icons/lu";

const SURFACE_META: Record<
  TransactionSurface,
  { title: string; description: string; icon: JSX.Element }
> = {
  receipt: {
    title: "Receipts",
    description: "When goods arrive at a location",
    icon: <LuTruck />
  },
  shipment: {
    title: "Shipments",
    description: "When goods leave a location",
    icon: <LuPackage />
  },
  stockTransfer: {
    title: "Stock transfers",
    description: "When goods move between storage units",
    icon: <LuArrowRightLeft />
  },
  warehouseTransfer: {
    title: "Warehouse transfers",
    description: "When goods move between warehouses",
    icon: <LuWarehouse />
  },
  inventoryAdjustment: {
    title: "Inventory adjustments",
    description: "Manual quantity edits at a storage unit",
    icon: <LuScale />
  }
};

type SurfacesFieldProps = {
  name: string;
  label?: string;
};

/**
 * Multi-select for the rule's `surfaces` field. Uses ChoiceSelect's `multiple`
 * mode — same compact trigger style as the severity picker.
 *
 * Soft-guards against unchecking the last selected surface (zod `min(1)` is
 * the server-side backstop).
 */
export default function SurfacesField({ name, label }: SurfacesFieldProps) {
  const { t } = useLingui();
  const { error, isOptional } = useField(name);
  const [value, setValue] = useControlField<TransactionSurface[]>(name);
  const selected = value ?? [];

  const options: ChoiceSelectOption<TransactionSurface>[] =
    TRANSACTION_SURFACES.map((s) => ({
      value: s,
      title: SURFACE_META[s].title,
      description: SURFACE_META[s].description,
      icon: SURFACE_META[s].icon
    }));

  const handleChange = (next: TransactionSurface[]) => {
    if (next.length === 0) return; // soft guard — keep at least one
    setValue(next);
  };

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel isOptional={isOptional} htmlFor={name}>
        {label ?? t`Applies to`}
      </FormLabel>

      {selected.map((surface, index) => (
        <input
          key={surface}
          type="hidden"
          name={`${name}[${index}]`}
          value={surface}
        />
      ))}

      <ChoiceSelect<TransactionSurface>
        multiple
        value={selected}
        onChange={handleChange}
        options={options}
        placeholder={t`Select surfaces`}
        aria-label={label ?? t`Applies to`}
      />

      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}
