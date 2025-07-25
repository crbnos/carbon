import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { usePermissions } from "~/hooks";
import type { getMaterialFormsList } from "~/modules/items";
import { MaterialShapeForm } from "~/modules/items/ui/MaterialShapes";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";

type ShapeSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const ShapePreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
) => {
  const shape = options.find((o) => o.value === value);
  // @ts-ignore
  return <Enumerable value={shape?.label ?? null} />;
};

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
        inline={props.inline ? ShapePreview : undefined}
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
            code: created.slice(0, 3).toUpperCase(),
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      {...props}
      inline={props.inline ? ShapePreview : undefined}
      label={props?.label ?? "Shape"}
    />
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
      helper: c.companyId === null ? "Standard" : undefined,
      code: c.code,
    }));
  }, [materialFormsLoader.data?.data]);

  return options;
};
