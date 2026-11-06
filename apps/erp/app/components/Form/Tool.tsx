// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { useControlField, useField, useInlineField } from "@carbon/form";
import {
  CreatableCombobox,
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  VStack
} from "@carbon/react";
import { useEffect, useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import ToolForm from "~/modules/items/ui/Tools/ToolForm";

import { useTools } from "~/stores";
import { useEmptyState } from "./emptyStates";

type ToolSelectProps = Omit<ComboboxProps, "options" | "type" | "inline"> & {
  disabledTools?: string[];
  includeInactive?: boolean;
  inline?: boolean;
  typeFieldName?: string;
};

const ToolPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element; helper?: string }[]
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
        helper: item.name
      })) ?? [],
    [tools]
  );

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
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

  const inlineField = useInlineField({
    inline: !!props.inline,
    label,
    isEmpty: !value,
    isReadOnly: props.isReadOnly
  });

  const emptyMessage = useEmptyState("tool", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <FormControl isInvalid={!!error} className="w-full">
        {label && inlineField.showLabel && (
          <FormLabel isOptional={fieldIsOptional}>{label}</FormLabel>
        )}
        <input
          {...getInputProps({
            id: name
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
            emptyMessage={emptyMessage}
            {...props}
            inline={props.inline ? ToolPreview : undefined}
            inlinePlaceholder={inlineField.placeholder}
            value={value?.replace(/"/g, '\\"')}
            onChange={(newValue) => {
              setValue(newValue?.replace(/"/g, '\\"') ?? "");
              onChange(newValue?.replace(/"/g, '\\"') ?? "");
            }}
            label={label}
            itemHeight={44}
            onCreateOption={(option) => {
              create.open(option);
            }}
          />
        </div>
        {error ? (
          <FormErrorMessage>{error}</FormErrorMessage>
        ) : (
          helperText && <FormHelperText>{helperText}</FormHelperText>
        )}
      </FormControl>
      {create.item !== null && (
        <ToolForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            id: "",
            revision: "0",
            name: create.item,
            description: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Pull from Inventory",
            unitCost: 0,
            shelfLifeCalculateFromBom: false,
            tags: []
          }}
        />
      )}
    </>
  );
};

Tool.displayName = "Tool";

export default Tool;
