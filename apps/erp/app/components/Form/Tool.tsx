import type { ComboboxProps } from "@carbon/form";
import { useControlField, useField } from "@carbon/form";
import {
  cn,
  CreatableCombobox,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import ToolForm from "~/modules/items/ui/Tools/ToolForm";

import { useTools } from "~/stores";

type ToolSelectProps = Omit<ComboboxProps, "options" | "type" | "inline"> & {
  disabledTools?: string[];
  includeInactive?: boolean;
  inline?: boolean;
  typeFieldName?: string;
};

const ToolPreview = (
  value: string,
  options: { value: string; label: string; helper?: string }[]
) => {
  const item = options.find((o) => o.value === value);
  if (!item) return null;
  return (
    <VStack spacing={0}>
      <span className="font-medium text-sm">{item.label}</span>
      {item.helper && (
        <span className="text-xs text-muted-foreground">{item.helper}</span>
      )}
    </VStack>
  );
};

const Tool = ({ name, label, helperText, ...props }: ToolSelectProps) => {
  const tools = useTools();

  const options = useMemo(
    () =>
      tools.map((item) => ({
        value: item.id,
        label: item.readableIdWithRevision,
        helper: item.name,
      })) ?? [],
    [tools]
  );

  const newToolsModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { getInputProps, error } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);

  useEffect(() => {
    if (props.value !== null && props.value !== undefined)
      setValue(props.value);
  }, [props.value, setValue]);

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(options.find((o) => o.value === value) ?? null);
    } else {
      props?.onChange?.(null);
    }
  };

  return (
    <>
      <FormControl isInvalid={!!error} className="w-full">
        {label && <FormLabel>{label}</FormLabel>}
        <input
          {...getInputProps({
            id: name,
          })}
          type="hidden"
          name={name}
          id={name}
          value={value}
        />

        <div className="flex flex-grow tools-start min-w-0">
          <CreatableCombobox
            className={cn("flex-grow min-w-0")}
            ref={triggerRef}
            options={options}
            {...props}
            inline={props.inline ? ToolPreview : undefined}
            inlineAddLabel="Add Tool"
            value={value?.replace(/"/g, '\\"')}
            onChange={(newValue) => {
              setValue(newValue?.replace(/"/g, '\\"') ?? "");
              onChange(newValue?.replace(/"/g, '\\"') ?? "");
            }}
            label={label}
            itemHeight={44}
            onCreateOption={(option) => {
              newToolsModal.onOpen();
              setCreated(option);
            }}
          />
        </div>
        {error ? (
          <FormErrorMessage>{error}</FormErrorMessage>
        ) : (
          helperText && <FormHelperText>{helperText}</FormHelperText>
        )}
      </FormControl>

      {newToolsModal.isOpen && (
        <ToolForm
          type="modal"
          onClose={() => {
            setCreated("");
            newToolsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            revision: "0",
            name: created,
            description: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: true,
            unitCost: 0,
            tags: [],
          }}
        />
      )}
    </>
  );
};

Tool.displayName = "Tool";

export default Tool;
