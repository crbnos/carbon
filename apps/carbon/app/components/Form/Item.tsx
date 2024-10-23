import type { ComboboxProps } from "@carbon/form";
import { useControlField, useField } from "@carbon/form";
import {
  cn,
  CreatableCombobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  IconButton,
  useDisclosure,
} from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ConsumableForm,
  FixtureForm,
  MaterialForm,
  PartForm,
  ToolForm,
} from "~/modules/items";
import { methodItemType, type MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { MethodItemTypeIcon } from "../Icons";

type ItemSelectProps = Omit<ComboboxProps, "options" | "type"> & {
  disabledItems?: string[];
  includeInactive?: boolean;
  replenishmentSystem?: "Buy" | "Make";
  type: MethodItemType;
  typeFieldName?: string;
  validItemTypes?: MethodItemType[];
  onTypeChange?: (type: MethodItemType) => void;
};

const Item = ({
  name,
  label,
  helperText,
  isOptional = false,
  type,
  typeFieldName = "itemType",
  validItemTypes,
  onTypeChange,
  ...props
}: ItemSelectProps) => {
  const [items] = useItems();

  const options = useMemo(() => {
    const results =
      (props?.replenishmentSystem || props?.includeInactive !== true
        ? items.filter(
            (item) =>
              item.type === type &&
              (props.replenishmentSystem === undefined ||
                item.replenishmentSystem === props.replenishmentSystem ||
                item.replenishmentSystem === "Buy and Make" ||
                props.replenishmentSystem === item.replenishmentSystem) &&
              (item.active === true || props?.includeInactive === true)
          )
        : items
      )
        .filter((item) => item.type === type)
        .map((item) => ({
          value: item.id,
          label: item.readableId,
          helper: item.name,
        })) ?? [];

    if (props.disabledItems) {
      return results.filter(
        (item) => !props.disabledItems?.includes(item.value)
      );
    }

    return results;
  }, [
    items,
    props?.includeInactive,
    props.disabledItems,
    props.replenishmentSystem,
    type,
  ]);

  const newItemsModal = useDisclosure();
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

  const canSwitchItemType = typeof onTypeChange === "function";

  return (
    <>
      <FormControl isInvalid={!!error} className="w-full">
        {type && (
          <FormLabel htmlFor={name} isOptional={isOptional}>
            {type}
          </FormLabel>
        )}
        <input
          {...getInputProps({
            id: name,
          })}
          type="hidden"
          name={name}
          id={name}
          value={value}
        />
        <input
          type="hidden"
          name={typeFieldName}
          id={typeFieldName}
          value={type}
        />
        <div className="flex flex-grow min-w-0">
          <CreatableCombobox
            className={cn(
              "flex-grow min-w-0",
              canSwitchItemType && "rounded-r-none"
            )}
            ref={triggerRef}
            options={options}
            {...props}
            value={value?.replace(/"/g, '\\"')}
            onChange={(newValue) => {
              setValue(newValue?.replace(/"/g, '\\"') ?? "");
              onChange(newValue?.replace(/"/g, '\\"') ?? "");
            }}
            isClearable={isOptional && !props.isReadOnly}
            label={label}
            itemHeight={44}
            onCreateOption={(option) => {
              newItemsModal.onOpen();
              setCreated(option);
            }}
          />
          {canSwitchItemType && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  type="button"
                  aria-label="Change Type"
                  className="bg-transparent flex-shrink-0 h-10 w-10 px-3 rounded-l-none border-l-0 shadow-sm"
                  disabled={props.isReadOnly}
                  variant="secondary"
                  size="lg"
                  icon={<MethodItemTypeIcon type={type} />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {Object.values(methodItemType)
                  .filter(
                    (itemType) =>
                      validItemTypes === undefined ||
                      (Array.isArray(validItemTypes) &&
                        validItemTypes.includes(itemType))
                  )
                  .map((itemType) => (
                    <DropdownMenuItem
                      key={itemType}
                      onSelect={() => {
                        if (type !== itemType) onTypeChange?.(itemType);
                      }}
                    >
                      <DropdownMenuIcon
                        icon={<MethodItemTypeIcon type={itemType} />}
                      />
                      <span>{itemType}</span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {error ? (
          <FormErrorMessage>{error}</FormErrorMessage>
        ) : (
          helperText && <FormHelperText>{helperText}</FormHelperText>
        )}
      </FormControl>
      {type === "Part" && newItemsModal.isOpen && (
        <PartForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemTrackingType: "Inventory",
            replenishmentSystem: "Make",
            unitOfMeasureCode: "EA",
            defaultMethodType: "Make",
            active: props?.includeInactive === undefined,
            unitCost: 0,
          }}
        />
      )}
      {type === "Consumable" && newItemsModal.isOpen && (
        <ConsumableForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemTrackingType: "Non-Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
            unitCost: 0,
          }}
        />
      )}
      {type === "Fixture" && newItemsModal.isOpen && (
        <FixtureForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Make",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
            unitCost: 0,
          }}
        />
      )}
      {type === "Material" && newItemsModal.isOpen && (
        <MaterialForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            materialFormId: "",
            materialSubstanceId: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
            unitCost: 0,
          }}
        />
      )}
      {/* TODO: Add service */}
      {type === "Tool" && newItemsModal.isOpen && (
        <ToolForm
          type="modal"
          onClose={() => {
            setCreated("");
            newItemsModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            id: "",
            name: created,
            description: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: "Buy",
            defaultMethodType: "Buy",
            active: props?.includeInactive === undefined,
            unitCost: 0,
          }}
        />
      )}
    </>
  );
};

Item.displayName = "Item";

export default Item;
