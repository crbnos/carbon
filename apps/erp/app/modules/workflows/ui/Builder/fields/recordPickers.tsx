import { Combobox } from "@carbon/react";
import type { ComponentType } from "react";
import { useMemo } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useIssueTypes } from "~/components/Form/IssueType";
import { useLocations } from "~/components/Form/Location";
import { UserSelect } from "~/components/Selectors";
import type { IndividualOrGroup } from "~/components/Selectors/UserSelect/types";
import { useCustomers, useItems, useSuppliers } from "~/stores";

// Plain Combobox, never CreatableCombobox: a workflow picks an existing record,
// so a "Create <whatever you typed>" row would be an offer we cannot honor.
export type RecordPickerProps = {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  isDisabled?: boolean;
};

// ── Customer ────────────────────────────────────────────────────────────────

const CustomerPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => {
  const [customers] = useCustomers();
  const options = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name })),
    [customers]
  );
  return (
    <Combobox
      options={options}
      value={value}
      isClearable
      isReadOnly={isDisabled}
      placeholder="Select customer…"
      onChange={(id) => onChange(id || undefined)}
    />
  );
};

// ── Supplier ─────────────────────────────────────────────────────────────────

const SupplierPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => {
  const [suppliers] = useSuppliers();
  const options = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );
  return (
    <Combobox
      options={options}
      value={value}
      isClearable
      isReadOnly={isDisabled}
      placeholder="Select supplier…"
      onChange={(id) => onChange(id || undefined)}
    />
  );
};

// ── Item (all types) ─────────────────────────────────────────────────────────

const ItemPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => {
  const [items] = useItems();
  const options = useMemo(
    () =>
      items
        .filter((i) => i.active)
        .map((i) => ({
          value: i.id,
          label: i.name,
          helper: i.readableIdWithRevision
        })),
    [items]
  );
  return (
    <Combobox
      options={options}
      value={value}
      isClearable
      isReadOnly={isDisabled}
      placeholder="Select item…"
      onChange={(id) => onChange(id || undefined)}
    />
  );
};

// ── Location ─────────────────────────────────────────────────────────────────

const LocationPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => {
  const locations = useLocations();
  return (
    <Combobox
      options={locations}
      value={value}
      isClearable
      isReadOnly={isDisabled}
      placeholder="Select location…"
      onChange={(id) => onChange(id || undefined)}
    />
  );
};

// ── Issue type ───────────────────────────────────────────────────────────────

const IssueTypePicker = ({
  value,
  onChange,
  isDisabled
}: RecordPickerProps) => {
  const options = useIssueTypes();
  return (
    <Combobox
      options={options.map((o) => ({
        value: o.value,
        label: <Enumerable value={o.label} />
      }))}
      value={value}
      isClearable
      isReadOnly={isDisabled}
      placeholder="Select issue type…"
      onChange={(id) => onChange(id || undefined)}
    />
  );
};

// ── User (employees only, single-select) ─────────────────────────────────────

function handleUserChange(
  items: IndividualOrGroup[],
  onChange: (id: string | undefined) => void
) {
  onChange(items[0]?.id ?? undefined);
}

const UserPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => (
  <UserSelect
    value={value}
    usersOnly
    isMulti={false}
    insideCanvas
    disabled={isDisabled}
    onChange={(items) => handleUserChange(items, onChange)}
  />
);

// ── Group (single-select, raw group id) ──────────────────────────────────────

const GroupPicker = ({ value, onChange, isDisabled }: RecordPickerProps) => (
  <UserSelect
    value={value}
    isMulti={false}
    insideCanvas
    disabled={isDisabled}
    onChange={(items) => handleUserChange(items, onChange)}
  />
);

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * Maps a registry entity name to a controlled Carbon selector.
 * Unmapped entities (purchaseOrder, salesOrder, job, receipt, shipment, quote,
 * nonConformance, jobOperation, salesInvoice, purchaseInvoice) fall back to a
 * plain text Input in LiteralControl — no store is available for those.
 */
export const hasRecordPicker = (entity: string) => entity in RECORD_PICKERS;

export const RECORD_PICKERS: Partial<
  Record<string, ComponentType<RecordPickerProps>>
> = {
  customer: CustomerPicker,
  supplier: SupplierPicker,
  item: ItemPicker,
  location: LocationPicker,
  nonConformanceType: IssueTypePicker,
  user: UserPicker,
  group: GroupPicker
};
