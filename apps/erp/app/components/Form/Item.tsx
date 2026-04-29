import type { ComboboxProps } from "@carbon/form";
import { useControlField, useField } from "@carbon/form";
import {
  Button,
  CreatableCombobox,
  cn,
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
  useMount
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuFilter } from "react-icons/lu";
import { useFetcher } from "react-router";
import ConsumableForm from "~/modules/items/ui/Consumables/ConsumableForm";
import MaterialForm from "~/modules/items/ui/Materials/MaterialForm";
import PartForm from "~/modules/items/ui/Parts/PartForm";
import ToolForm from "~/modules/items/ui/Tools/ToolForm";
import type { MethodItemType } from "~/modules/shared";
import { methodItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { MethodItemTypeIcon } from "../Icons";

type ItemSelectProps = Omit<ComboboxProps, "options" | "type" | "inline"> & {
  isReadOnly?: boolean;
  blacklist?: string[];
  includeInactive?: boolean;
  inline?: boolean;
  isConfigured?: boolean;
  locationId?: string;
  replenishmentSystem?: "Buy" | "Make";
  type: MethodItemType | "Item";
  typeFieldName?: string;
  validItemTypes?: MethodItemType[];
  whitelist?: string[];
  onConfigure?: () => void;
  onTypeChange?: (type: MethodItemType | "Item") => void;
};

const ItemPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const item = options.find((o) => o.value === value);
  if (!item) return null;
  return <span>{item.label}</span>;
};

const useTranslatedItemType = () => {
  const { t } = useLingui();
  return (type: MethodItemType | "Item") => {
    switch (type) {
      case "Item":
        return t`Item`;
      case "Part":
        return t`Part`;
      case "Material":
        return t`Material`;
      case "Tool":
        return t`Tool`;
      case "Consumable":
        return t`Consumable`;
      default:
        return type;
    }
  };
};

const Item = ({
  name,
  label,
  helperText,
  isConfigured = false,
  isOptional,
  type = "Part",
  typeFieldName = "itemType",
  validItemTypes,
  onConfigure,
  onTypeChange,
  isReadOnly = false,
  ...props
}: ItemSelectProps) => {
  const { t } = useLingui();
  const translateItemType = useTranslatedItemType();
  const [items] = useItems();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const options = useMemo(() => {
    let results = items
      .filter((item) => {
        // Filter by type
        // @ts-expect-error
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
      .map((item) => {
        const scopedQuantity = props.locationId
          ? item.quantityByLocation?.[props.locationId]
          : item.quantityOnHand;
        return {
          value: item.id,
          label: item.readableIdWithRevision,
          helper: item.name,
          helperRight:
            scopedQuantity !== undefined
              ? `${scopedQuantity} ${item.unitOfMeasureCode}`
              : undefined
        };
      });

    if (props.whitelist) {
      results = results.filter((item) => props.whitelist?.includes(item.value));
    }

    if (props.blacklist) {
      return results.filter((item) => !props.blacklist?.includes(item.value));
    }

    return results;
  }, [
    items,
    props?.includeInactive,
    props.blacklist,
    props.locationId,
    props.replenishmentSystem,
    props.whitelist,
    type
  ]);

  const selectTypeModal = useDisclosure();
  const newItemsModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);
  const resolvedIsOptional = isOptional ?? fieldIsOptional ?? false;

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
            isOptional={resolvedIsOptional}
            onConfigure={onConfigure}
          >
            {translateItemType(type)}
          </FormLabel>
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
            label={
              label === "Item"
                ? t`Item`
                : label === "Part"
                  ? t`Part`
                  : label === "Material"
                    ? t`Material`
                    : label === "Tool"
                      ? t`Tool`
                      : label === "Consumable"
                        ? t`Consumable`
                        : undefined
            }
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
                      aria-label={t`Change Type`}
                      className={cn(
                        "absolute right-0 top-0 bg-card dark:bg-card flex-shrink-0 h-10 w-10 px-3 rounded-l-none before:rounded-l-none border -ml-px shadow-none hover:shadow-button-base"
                      )}
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
                  <Trans>
                    Change the item type (e.g. Part, Material, Tool, etc.)
                  </Trans>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={type}
                  // @ts-expect-error
                  onValueChange={onTypeChange}
                >
                  <DropdownMenuRadioItem
                    value="Item"
                    className="flex items-center gap-2"
                  >
                    <LuFilter className="h-4 w-4" />
                    <span>
                      <Trans>All Items</Trans>
                    </span>
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
                        <span>{translateItemType(itemType)}</span>
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
              <ModalTitle>
                <Trans>Select Item Type</Trans>
              </ModalTitle>
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
                    {translateItemType(itemType)}
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
                <Trans>Cancel</Trans>
              </Button>
              <Button
                ref={submitRef}
                isDisabled={type === "Item"}
                onClick={() => {
                  selectTypeModal.onClose();
                  newItemsModal.onOpen();
                }}
              >
                <Trans>Create</Trans>
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
              props?.replenishmentSystem === "Buy"
                ? "Pull from Inventory"
                : "Make to Order",
            unitCost: 0,
            lotSize: 0,
            shelfLifeCalculateFromBom: false,
            tags: []
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
            defaultMethodType: "Pull from Inventory",
            unitCost: 0,
            shelfLifeCalculateFromBom: false,
            tags: []
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
            defaultMethodType: "Pull from Inventory",
            unitCost: 0,
            shelfLifeCalculateFromBom: false,
            tags: []
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
              props?.replenishmentSystem === "Buy"
                ? "Pull from Inventory"
                : "Make to Order",
            unitCost: 0,
            shelfLifeCalculateFromBom: false,
            tags: []
          }}
        />
      )}
    </>
  );
};

Item.displayName = "Item";

export default Item;

export const useConfigurableItems = () => {
  const configurableItemsLoader = useFetcher<{
    data: { itemId: string }[] | null;
  }>();

  useMount(() => {
    configurableItemsLoader.load(path.to.api.itemConfigurable);
  });

  const configurableItemIds = useMemo(() => {
    return (configurableItemsLoader.data?.data ?? []).map((c) => c.itemId);
  }, [configurableItemsLoader.data?.data]);

  return configurableItemIds;
};
