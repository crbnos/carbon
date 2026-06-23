import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import type { getMaterialSubstancesList } from "~/modules/items";
import { MaterialSubstanceForm } from "~/modules/items/ui/MaterialSubstances";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type SubstanceSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const SubstancePreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode; helper?: string }[]
) => {
  const substance = options.find((o) => o.value === value);
  // @ts-ignore
  return <Enumerable value={substance?.label ?? null} />;
};

const Substance = (props: SubstanceSelectProps) => {
  const options = useSubstance();
  const permissions = usePermissions();

  const newSubstanceModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const emptyMessage = useEmptyState("materialSubstance", {
    onCreate: () => newSubstanceModal.onOpen()
  });

  return permissions.can("create", "parts") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props.inline ? SubstancePreview : undefined}
        label={props?.label ?? "Substance"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          newSubstanceModal.onOpen();
          setCreated(option);
        }}
      />
      {newSubstanceModal.isOpen && (
        <MaterialSubstanceForm
          type="modal"
          onClose={() => {
            setCreated("");
            newSubstanceModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            code: created.slice(0, 3).toUpperCase()
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      {...props}
      inline={props.inline ? SubstancePreview : undefined}
      label={props?.label ?? "Substance"}
    />
  );
};

Substance.displayName = "Substance";

export default Substance;

export const useSubstance = () => {
  const materialSubstances =
    useFetcher<Awaited<ReturnType<typeof getMaterialSubstancesList>>>();

  useMount(() => {
    materialSubstances.load(path.to.api.materialSubstances);
  });

  const options = useMemo(() => {
    return (materialSubstances.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined,
      code: c.code
    }));
  }, [materialSubstances.data?.data]);

  return options;
};
