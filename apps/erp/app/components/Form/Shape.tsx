import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { usePermissions } from "~/hooks";
import type { getMaterialFormsList } from "~/modules/items";
import { MaterialShapeForm } from "~/modules/items/ui/MaterialForms";

import { path } from "~/utils/path";

type ShapeSelectProps = Omit<ComboboxProps, "options">;

const Shape = (props: ShapeSelectProps) => {
  const options = useShape();
  const permissions = usePermissions();

  const newShapeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  return permissions.can("create", "inventory") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Shape"}
        onCreateOption={(option) => {
          newShapeModal.onOpen();
          setCreated(option);
        }}
      />
      {newShapeModal.isOpen && (
        <MaterialShapeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newShapeModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
          }}
        />
      )}
    </>
  ) : (
    <Combobox options={options} {...props} label={props?.label ?? "Form"} />
  );
};

Shape.displayName = "Shape";

export default Shape;

export const useShape = () => {
  const materialFormsLoader =
    useFetcher<Awaited<ReturnType<typeof getMaterialFormsList>>>();

  useMount(() => {
    materialFormsLoader.load(path.to.api.materialForms);
  });

  const options = useMemo(() => {
    return (materialFormsLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
    }));
  }, [materialFormsLoader.data?.data]);

  return options;
};
