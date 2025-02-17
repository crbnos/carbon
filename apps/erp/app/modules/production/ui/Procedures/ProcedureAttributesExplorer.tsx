import {
  Array as ArrayInput,
  Hidden,
  Input,
  Number,
  SelectControlled,
  Submit,
  TextArea,
  ValidatedForm,
} from "@carbon/form";
import {
  Button,
  HStack,
  Kbd,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerTitle,
  DrawerHeader,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useKeyboardShortcuts,
  VStack,
  ToggleGroup,
  ToggleGroupItem,
  DrawerFooter,
  IconButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useDebounce,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuInfo,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
import { Empty } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Procedure, ProcedureAttribute } from "../../types";
import { ConfirmDelete } from "~/components/Modals";
import {
  procedureAttributeType,
  procedureAttributeValidator,
} from "../../production.models";
import { ProcedureAttributeTypeIcon } from "~/components/Icons";
import { UnitOfMeasure } from "~/components/Form";
import type { z } from "zod";
import { Reorder } from "framer-motion";
import { flushSync } from "react-dom";

export default function ProcedureAttributesExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const procedureData = useRouteData<{
    procedure: Procedure;
    versions: Procedure[];
    attributes: ProcedureAttribute[];
  }>(path.to.procedure(id));
  const permissions = usePermissions();
  const sortOrderFetcher = useFetcher<{
    success: boolean;
  }>();

  const procedureAttributeDisclosure = useDisclosure();
  const deleteAttributeDisclosure = useDisclosure();
  const [selectedAttribute, setSelectedAttribute] =
    useState<ProcedureAttribute | null>(null);

  const maxSortOrder =
    procedureData?.attributes?.reduce(
      (acc, attr) => Math.max(acc, attr.sortOrder),
      0
    ) ?? 0;

  const procedureAttribtueInitialValues = {
    id: selectedAttribute?.id,
    procedureId: id,
    name: selectedAttribute?.name ?? "",
    description: selectedAttribute?.description ?? "",
    type: selectedAttribute?.type ?? "Measurement",
    sortOrder: selectedAttribute?.sortOrder ?? maxSortOrder + 1,
    unitOfMeasureCode: selectedAttribute?.unitOfMeasureCode ?? "",
    minValue: selectedAttribute ? selectedAttribute?.minValue ?? undefined : 0,
    maxValue: selectedAttribute ? selectedAttribute?.maxValue ?? undefined : 0,
    listValues: selectedAttribute?.listValues ?? [],
  };

  const isDisabled = procedureData?.procedure?.status !== "Draft";

  const [sortOrder, setSortOrder] = useState<string[]>(
    Array.isArray(procedureData?.attributes)
      ? procedureData.attributes
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((attr) => attr.id)
      : []
  );

  useEffect(() => {
    if (Array.isArray(procedureData?.attributes)) {
      const sorted = [...procedureData.attributes]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((attr) => attr.id);
      setSortOrder(sorted);
    }
  }, [procedureData?.attributes]);

  const onReorder = (newOrder: string[]) => {
    if (isDisabled) return;

    const updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.procedureAttributeOrder(id),
      });
    },
    2500,
    true
  );

  const onDeleteAttribute = (attribute: ProcedureAttribute) => {
    if (isDisabled) return;
    setSelectedAttribute(attribute);
    deleteAttributeDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedAttribute(null);
    deleteAttributeDisclosure.onClose();
  };

  const onEditAttribute = (attribute: ProcedureAttribute) => {
    if (isDisabled) return;
    flushSync(() => {
      setSelectedAttribute(attribute);
    });
    procedureAttributeDisclosure.onOpen();
  };

  const newButtonRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+a": (event: KeyboardEvent) => {
      event.stopPropagation();
      if (!isDisabled) {
        newButtonRef.current?.click();
      }
    },
  });

  const attributeMap = useMemo(
    () =>
      procedureData?.attributes?.reduce<Record<string, ProcedureAttribute>>(
        (acc, attr) => ({ ...acc, [attr.id]: attr }),
        {}
      ) ?? {},
    [procedureData?.attributes]
  );

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {procedureData?.attributes && procedureData.attributes.length > 0 ? (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full"
              disabled={isDisabled}
            >
              {sortOrder.map((sortId) => (
                <Reorder.Item
                  key={sortId}
                  value={sortId}
                  className="rounded-lg w-full"
                  dragListener={!isDisabled}
                >
                  <ProcedureAttributeItem
                    key={sortId}
                    isDisabled={isDisabled}
                    attribute={attributeMap[sortId]}
                    onDelete={onDeleteAttribute}
                    onEdit={onEditAttribute}
                  />
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            <Empty>
              {permissions.can("update", "production") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={() => {
                    flushSync(() => {
                      setSelectedAttribute(null);
                    });
                    procedureAttributeDisclosure.onOpen();
                  }}
                >
                  Add Attribute
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex flex-0 sm:flex-row border-t border-border p-4 sm:justify-start sm:space-x-2">
          <Tooltip>
            <TooltipTrigger className="w-full">
              <Button
                ref={newButtonRef}
                className="w-full"
                isDisabled={
                  isDisabled || !permissions.can("update", "production")
                }
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={() => {
                  flushSync(() => {
                    setSelectedAttribute(null);
                  });
                  procedureAttributeDisclosure.onOpen();
                }}
              >
                Add Attribute
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>
                <span>Add Attribute</span>
                <Kbd>{prettifyKeyboardShortcut("Command+Shift+a")}</Kbd>
              </HStack>
            </TooltipContent>
          </Tooltip>
        </div>
      </VStack>
      {procedureAttributeDisclosure.isOpen && (
        <ProcedureAttributeForm
          initialValues={procedureAttribtueInitialValues}
          isDisabled={isDisabled}
          onClose={procedureAttributeDisclosure.onClose}
        />
      )}
      {deleteAttributeDisclosure.isOpen && selectedAttribute && (
        <DeleteProcedureAttribute
          attribute={selectedAttribute}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
}

type ProcedureAttributeProps = {
  attribute: ProcedureAttribute;
  isDisabled: boolean;
  onEdit: (attribute: ProcedureAttribute) => void;
  onDelete: (attribute: ProcedureAttribute) => void;
};

function ProcedureAttributeItem({
  attribute,
  isDisabled,
  onEdit,
  onDelete,
}: ProcedureAttributeProps) {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const permissions = usePermissions();

  if (!attribute || !attribute.id || !attribute.name) return null;

  return (
    <HStack
      className={`group w-full p-2 items-center hover:bg-accent/30 relative border-b ${
        !isDisabled ? "cursor-pointer" : ""
      }`}
    >
      <IconButton
        aria-label="Drag handle"
        icon={<LuGripVertical />}
        variant="ghost"
        disabled={isDisabled}
      />
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Tooltip>
            <TooltipTrigger>
              <ProcedureAttributeTypeIcon
                type={attribute.type}
                className="flex-shrink-0"
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="text-foreground text-sm">{attribute.type}</p>
            </TooltipContent>
          </Tooltip>
          <VStack spacing={0} className="flex-grow">
            <HStack>
              <p className="text-foreground text-sm">{attribute.name}</p>
              {attribute.description && (
                <Tooltip>
                  <TooltipTrigger>
                    <LuInfo className="text-muted-foreground size-3" />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="text-foreground text-sm">
                      {attribute.description}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
            {(attribute.minValue !== null || attribute.maxValue !== null) && (
              <p className="text-muted-foreground text-xs">
                {attribute.minValue !== null && attribute.maxValue !== null
                  ? `Must be between ${attribute.minValue} and ${attribute.maxValue}`
                  : attribute.minValue !== null
                  ? `Must be > ${attribute.minValue}`
                  : `Must be < ${attribute.maxValue}`}
              </p>
            )}
          </VStack>
        </HStack>
      </VStack>
      {!isDisabled && (
        <div className="absolute right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="More"
                className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                icon={<LuEllipsisVertical />}
                variant="solid"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(attribute);
                }}
              >
                <DropdownMenuIcon icon={<LuPencil />} />
                Edit Attribute
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={!permissions.can("update", "production")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(attribute);
                }}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Attribute
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </HStack>
  );
}

function DeleteProcedureAttribute({
  attribute,
  onCancel,
}: {
  attribute: ProcedureAttribute;
  onCancel: () => void;
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  if (!attribute.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteProcedureAttribute(id, attribute.id)}
      name={attribute.name ?? "this attribute"}
      text={`Are you sure you want to delete the attribute: ${attribute.name}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
function ProcedureAttributeForm({
  initialValues,
  isDisabled,
  onClose,
}: {
  initialValues: z.infer<typeof procedureAttributeValidator>;
  isDisabled: boolean;
  onClose: () => void;
}) {
  const { id: procedureId } = useParams();
  if (!procedureId) throw new Error("id not found");

  const [type, setType] = useState<ProcedureAttribute["type"]>(
    initialValues.type
  );
  const [numericControls, setNumericControls] = useState<string[]>(() => {
    const controls = [];
    if (initialValues.type === "Measurement") {
      if (initialValues.minValue !== null) {
        controls.push("min");
      }
      if (initialValues.maxValue !== null) {
        controls.push("max");
      }
    }
    return controls;
  });

  const fetcher = useFetcher<{
    success: boolean;
  }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  const typeOptions = useMemo(
    () =>
      procedureAttributeType.map((type) => ({
        label: (
          <HStack>
            <ProcedureAttributeTypeIcon type={type} className="mr-2" />
            {type}
          </HStack>
        ),
        value: type,
      })),
    []
  );

  const isEditing = !!initialValues.id;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DrawerContent position="left">
        <ValidatedForm
          method="post"
          action={
            isEditing
              ? path.to.procedureAttribute(procedureId, initialValues.id!)
              : path.to.newProcedureAttribute(procedureId)
          }
          defaultValues={initialValues}
          validator={procedureAttributeValidator}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit Attribute" : "Add Attribute"}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="procedureId" />
            <Hidden name="sortOrder" />
            <VStack spacing={4}>
              <SelectControlled
                name="type"
                label="Type"
                options={typeOptions}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as ProcedureAttribute["type"]);
                  }
                }}
              />
              <Input name="name" label="Name" />
              <TextArea name="description" label="Description" />
              {type === "Measurement" && (
                <>
                  <UnitOfMeasure
                    name="unitOfMeasureCode"
                    label="Unit of Measure"
                  />

                  <ToggleGroup
                    type="multiple"
                    value={numericControls}
                    onValueChange={setNumericControls}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="min">Minimum</ToggleGroupItem>
                    <ToggleGroupItem value="max">Maximum</ToggleGroupItem>
                  </ToggleGroup>

                  {numericControls.includes("min") && (
                    <Number
                      name="minValue"
                      label="Minimum"
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10,
                      }}
                    />
                  )}
                  {numericControls.includes("max") && (
                    <Number
                      name="maxValue"
                      label="Maximum"
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10,
                      }}
                    />
                  )}
                </>
              )}
              {type === "List" && (
                <ArrayInput name="listOptions" label="List Options" />
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit isDisabled={isDisabled}>Save</Submit>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}
