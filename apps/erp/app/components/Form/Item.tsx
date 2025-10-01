import type { ComboboxProps } from "@carbon/form";
import { useControlField, useField } from "@carbon/form";
import {
  Button,
  cn,
  CreatableCombobox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuFilter } from "react-icons/lu";

import ConsumableForm from "~/modules/items/ui/Consumables/ConsumableForm";
import MaterialForm from "~/modules/items/ui/Materials/MaterialForm";
import PartForm from "~/modules/items/ui/Parts/PartForm";
import ToolForm from "~/modules/items/ui/Tools/ToolForm";
import { methodItemType, type MethodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { MethodItemTypeIcon } from "../Icons";

type ItemSelectProps = Omit<ComboboxProps, "options" | "type" | "inline"> & {
  disabledItems?: string[];
  includeInactive?: boolean;
  inline?: boolean;
  isConfigured?: boolean;
  replenishmentSystem?: "Buy" | "Make";
  type: MethodItemType | "Item";
  typeFieldName?: string;
  validItemTypes?: MethodItemType[];
  onConfigure?: () => void;
  onTypeChange?: (type: MethodItemType | "Item") => void;
};

const ItemPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const item = options.find((o) => o.value === value);
  if (!item) return null;
  return <span>{item.label}</span>;
};

const Item = ({
  name,
  label,
  helperText,
  isConfigured = false,
  isOptional = false,
  type = "Part",
  typeFieldName = "itemType",
  validItemTypes,
  onConfigure,
  onTypeChange,
  ...props
}: ItemSelectProps) => {
  const [items] = useItems();

  const options = useMemo(() => {
    const results = items
      .filter((item) => {
        // Filter by type
        // @ts-ignore
        if (validItemTypes && !validItemTypes.includes(item.type)) return false;

        if (type !== "Item" && type !== item.type) return false;

        // Filter by active status
        // Filter by active status
        if (!props.includeInactive && !item.active) return false;

        // Filter by replenishment system
        if (props.replenishmentSystem) {
          const systemMatches =
            item.replenishmentSystem === props.replenishmentSystem ||
            item.replenishmentSystem === "Buy and Make" ||
            props.replenishmentSystem === item.replenishmentSystem;

          if (!systemMatches) return false;
        }

        return true;
      })
      .map((item) => ({
        value: item.id,
        label: item.readableIdWithRevision,
        helper: item.name,
      }));

    if (props.disabledItems) {
      return results.filter(
        (item) => !props.disabledItems?.includes(item.value)
      );
    }

    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    items,
    props?.includeInactive,
    props.disabledItems,
    props.replenishmentSystem,
    type,
  ]);

  const selectTypeModal = useDisclosure();
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
  const submitRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <FormControl isInvalid={!!error} className="w-full">
        {type && (
          <FormLabel
            htmlFor={name}
            isConfigured={isConfigured}
            isOptional={isOptional}
            onConfigure={onConfigure}
          >
            {type === "Item" ? "Item" : type}
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
        <div className="flex flex-grow items-start min-w-0 relative">
          <CreatableCombobox
            className={cn("flex-grow min-w-0")}
            ref={triggerRef}
            options={options}
            {...props}
            inline={props.inline ? ItemPreview : undefined}
            value={value?.replace(/"/g, '\\"')}
            onChange={(newValue) => {
              setValue(newValue?.replace(/"/g, '\\"') ?? "");
              onChange(newValue?.replace(/"/g, '\\"') ?? "");
            }}
            isClearable={isOptional && !props.isReadOnly}
            // @ts-ignore
            label={label === "Item" ? "Item" : label}
            itemHeight={44}
            onCreateOption={(option) => {
              if (type === "Item") {
                selectTypeModal.onOpen();
                setCreated(option);
              } else {
                newItemsModal.onOpen();
                setCreated(option);
              }
            }}
          />
          {canSwitchItemType && !props.inline && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      type="button"
                      aria-label="Change Type"
                      className={cn(
                        "absolute right-0 top-0 bg-card dark:bg-card flex-shrink-0 h-10 w-10 px-3 rounded-l-none before:rounded-l-none border -ml-px shadow-none hover:shadow-button-base"
                      )}
                      disabled={props.isReadOnly}
                      variant="secondary"
                      size={props.inline ? "sm" : "md"}
                      icon={
                        type === "Item" ? (
                          <LuFilter className="size-3" />
                        ) : (
                          <MethodItemTypeIcon type={type} />
                        )
                      }
                    />
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  Change the item type (e.g. Part, Material, Tool, etc.)
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={type}
                  // @ts-ignore
                  onValueChange={onTypeChange}
                >
                  <DropdownMenuRadioItem
                    value="Item"
                    className="flex items-center gap-2"
                  >
                    <LuFilter className="h-4 w-4" />
                    <span>All Items</span>
                  </DropdownMenuRadioItem>
                  {Object.values(methodItemType)
                    .filter(
                      (itemType) =>
                        validItemTypes === undefined ||
                        (Array.isArray(validItemTypes) &&
                          validItemTypes.includes(itemType))
                    )
                    .map((itemType) => (
                      <DropdownMenuRadioItem
                        key={itemType}
                        value={itemType}
                        className="flex items-center gap-2"
                      >
                        <MethodItemTypeIcon type={itemType} />
                        <span>{itemType}</span>
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
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
      {selectTypeModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              selectTypeModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Select Item Type</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="grid grid-cols-2 gap-4">
                {Object.values(methodItemType).map((itemType) => (
                  <Button
                    key={itemType}
                    leftIcon={<MethodItemTypeIcon type={itemType} />}
                    className="flex w-full"
                    variant={type === itemType ? "primary" : "secondary"}
                    size="lg"
                    onClick={() => {
                      onTypeChange?.(itemType);
                      setTimeout(() => {
                        submitRef.current?.focus();
                      }, 0);
                    }}
                  >
                    {itemType}
                  </Button>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  selectTypeModal.onClose();
                }}
              >
                Cancel
              </Button>
              <Button
                ref={submitRef}
                isDisabled={type === "Item"}
                onClick={() => {
                  selectTypeModal.onClose();
                  newItemsModal.onOpen();
                }}
              >
                Create
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
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
            revision: "0",
            name: created,
            description: "",
            itemTrackingType: "Inventory",
            replenishmentSystem: props?.replenishmentSystem ?? "Make",
            unitOfMeasureCode: "EA",
            defaultMethodType:
              props?.replenishmentSystem === "Buy" ? "Pick" : "Make",
            unitCost: 0,
            lotSize: 0,
            tags: [],
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
            unitCost: 0,
            tags: [],
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
            unitCost: 0,
            tags: [],
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
            revision: "0",
            name: created,
            description: "",
            itemTrackingType: "Inventory",
            unitOfMeasureCode: "EA",
            replenishmentSystem: props?.replenishmentSystem ?? "Buy",
            defaultMethodType:
              props?.replenishmentSystem === "Buy" ? "Pick" : "Make",
            unitCost: 0,
            tags: [],
          }}
        />
      )}
    </>
  );
};

Item.displayName = "Item";

export default Item;
