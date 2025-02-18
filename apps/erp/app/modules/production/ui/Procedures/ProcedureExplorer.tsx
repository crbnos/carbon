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
  cn,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuActivity,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuInfo,
  LuMaximize2,
  LuMinimize2,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
import { Empty } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type {
  Procedure,
  ProcedureAttribute,
  ProcedureParameter,
} from "../../types";
import { ConfirmDelete } from "~/components/Modals";
import {
  procedureAttributeValidator,
  procedureParameterValidator,
} from "../../production.models";
import { ProcedureAttributeTypeIcon } from "~/components/Icons";
import { UnitOfMeasure } from "~/components/Form";
import type { z } from "zod";
import { Reorder } from "framer-motion";
import { flushSync } from "react-dom";
import { procedureAttributeType } from "~/modules/shared";

export default function ProcedureExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const procedureData = useRouteData<{
    procedure: Procedure;
    versions: Procedure[];
  }>(path.to.procedure(id));
  const permissions = usePermissions();
  const sortOrderFetcher = useFetcher<{
    success: boolean;
  }>();

  const procedureAttributeDisclosure = useDisclosure();
  const deleteAttributeDisclosure = useDisclosure();
  const procedureParameterDisclosure = useDisclosure();
  const deleteParameterDisclosure = useDisclosure();

  const [selectedAttribute, setSelectedAttribute] =
    useState<ProcedureAttribute | null>(null);
  const [selectedParameter, setSelectedParameter] =
    useState<ProcedureParameter | null>(null);

  const attributes = useMemo(
    () => procedureData?.procedure.procedureAttribute ?? [],
    [procedureData]
  );
  const parameters = useMemo(
    () => procedureData?.procedure.procedureParameter ?? [],
    [procedureData]
  );

  const maxSortOrder =
    attributes.reduce((acc, attr) => Math.max(acc, attr.sortOrder), 0) ?? 0;

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

  const procedureParameterInitialValues = {
    id: selectedParameter?.id,
    procedureId: id,
    key: selectedParameter?.key ?? "",
    value: selectedParameter?.value ?? "",
  };

  const isDisabled = procedureData?.procedure?.status !== "Draft";

  const [sortOrder, setSortOrder] = useState<string[]>(
    Array.isArray(attributes)
      ? attributes
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((attr) => attr.id)
      : []
  );

  useEffect(() => {
    if (Array.isArray(attributes)) {
      const sorted = [...attributes]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((attr) => attr.id);
      setSortOrder(sorted);
    }
  }, [attributes]);

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

  const onDeleteParameter = (parameter: ProcedureParameter) => {
    if (isDisabled) return;
    setSelectedParameter(parameter);
    deleteParameterDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedAttribute(null);
    setSelectedParameter(null);
    deleteAttributeDisclosure.onClose();
    deleteParameterDisclosure.onClose();
  };

  const onEditAttribute = (attribute: ProcedureAttribute) => {
    if (isDisabled) return;
    flushSync(() => {
      setSelectedAttribute(attribute);
    });
    procedureAttributeDisclosure.onOpen();
  };

  const onEditParameter = (parameter: ProcedureParameter) => {
    if (isDisabled) return;
    flushSync(() => {
      setSelectedParameter(parameter);
    });
    procedureParameterDisclosure.onOpen();
  };

  const newAttributeRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+a": (event: KeyboardEvent) => {
      event.stopPropagation();
      if (!isDisabled) {
        newAttributeRef.current?.click();
      }
    },
  });

  const newParameterRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+p": (event: KeyboardEvent) => {
      event.stopPropagation();
      if (!isDisabled) {
        newParameterRef.current?.click();
      }
    },
  });

  const attributeMap = useMemo(
    () =>
      attributes.reduce<Record<string, ProcedureAttribute>>(
        (acc, attr) => ({ ...acc, [attr.id]: attr }),
        {}
      ) ?? {},
    [attributes]
  );
  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <Tabs
          defaultValue="attributes"
          className="w-full flex-1 h-full flex flex-col"
        >
          <div className="w-full p-2">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="attributes">Attributes</TabsTrigger>
              <TabsTrigger value="parameters">Parameters</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="attributes"
            className="w-full flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <VStack
              className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
              spacing={0}
            >
              {attributes && attributes.length > 0 ? (
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
            <div className="w-full flex-none border-t border-border p-4">
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <Button
                    ref={newAttributeRef}
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
          </TabsContent>
          <TabsContent
            value="parameters"
            className="w-full flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <VStack
              className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
              spacing={0}
            >
              {parameters && parameters.length > 0 ? (
                parameters
                  .sort((a, b) => a.key.localeCompare(b.key))
                  .map((parameter) => (
                    <ProcedureParameterItem
                      key={parameter.id}
                      isDisabled={isDisabled}
                      parameter={parameter}
                      onDelete={onDeleteParameter}
                      onEdit={onEditParameter}
                    />
                  ))
              ) : (
                <Empty>
                  {permissions.can("update", "production") && (
                    <Button
                      isDisabled={isDisabled}
                      leftIcon={<LuCirclePlus />}
                      variant="secondary"
                      onClick={() => {
                        flushSync(() => {
                          setSelectedParameter(null);
                        });
                        procedureParameterDisclosure.onOpen();
                      }}
                    >
                      Add Parameter
                    </Button>
                  )}
                </Empty>
              )}
            </VStack>
            <div className="w-full flex-none border-t border-border p-4">
              <Tooltip>
                <TooltipTrigger className="w-full">
                  <Button
                    ref={newParameterRef}
                    className="w-full"
                    isDisabled={
                      isDisabled || !permissions.can("update", "production")
                    }
                    leftIcon={<LuCirclePlus />}
                    variant="secondary"
                    onClick={() => {
                      flushSync(() => {
                        setSelectedParameter(null);
                      });
                      procedureParameterDisclosure.onOpen();
                    }}
                  >
                    Add Parameter
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <HStack>
                    <span>Add Parameter</span>
                    <Kbd>{prettifyKeyboardShortcut("Command+Shift+p")}</Kbd>
                  </HStack>
                </TooltipContent>
              </Tooltip>
            </div>
          </TabsContent>
        </Tabs>
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
      {procedureParameterDisclosure.isOpen && (
        <ProcedureParameterForm
          initialValues={procedureParameterInitialValues}
          isDisabled={isDisabled}
          onClose={procedureParameterDisclosure.onClose}
        />
      )}
      {deleteParameterDisclosure.isOpen && selectedParameter && (
        <DeleteProcedureParameter
          parameter={selectedParameter}
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
      className={cn(
        "group w-full p-2 items-center hover:bg-accent/30 relative border-b bg-card"
      )}
    >
      <IconButton
        aria-label="Drag handle"
        icon={<LuGripVertical />}
        variant="ghost"
        disabled={isDisabled}
        className="cursor-grab"
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
            <TooltipContent side="top">
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

type ProcedureParameterProps = {
  parameter: ProcedureParameter;
  isDisabled: boolean;
  onEdit: (parameter: ProcedureParameter) => void;
  onDelete: (parameter: ProcedureParameter) => void;
};

function ProcedureParameterItem({
  parameter,
  isDisabled,
  onEdit,
  onDelete,
}: ProcedureParameterProps) {
  const permissions = usePermissions();
  return (
    <VStack
      spacing={0}
      className="group w-full px-4 py-2 items-start hover:bg-accent/30 relative border-b bg-card"
    >
      <HStack spacing={4}>
        <LuActivity className="flex-shrink-0" />
        <VStack spacing={0} className="flex-grow">
          <p className="text-foreground text-sm">{parameter.key}</p>
          <p className="text-muted-foreground text-xs">{parameter.value}</p>
        </VStack>
      </HStack>
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
                  onEdit(parameter);
                }}
              >
                <DropdownMenuIcon icon={<LuPencil />} />
                Edit Parameter
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={!permissions.can("update", "production")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(parameter);
                }}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Parameter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </VStack>
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
            <Hidden name="id" />
            <VStack spacing={4}>
              <SelectControlled
                name="type"
                label="Type"
                options={typeOptions}
                value={type}
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
                    <ToggleGroupItem value="min">
                      <LuMinimize2 className="mr-2" /> Minimum
                    </ToggleGroupItem>
                    <ToggleGroupItem value="max">
                      <LuMaximize2 className="mr-2" /> Maximum
                    </ToggleGroupItem>
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
                <ArrayInput name="listValues" label="List Options" />
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

interface ProcedureParameterFormProps {
  initialValues?: z.infer<typeof procedureParameterValidator>;
  isDisabled?: boolean;
  onClose: () => void;
}

function ProcedureParameterForm({
  initialValues,
  isDisabled = false,
  onClose,
}: ProcedureParameterFormProps) {
  const { id: procedureId } = useParams();
  if (!procedureId) throw new Error("id not found");

  const fetcher = useFetcher<{
    success: boolean;
  }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  const isEditing = !!initialValues?.id;

  return (
    <Drawer open onOpenChange={onClose}>
      <DrawerContent position="left">
        <DrawerHeader>
          <DrawerTitle>
            {isEditing ? "Edit Parameter" : "New Parameter"}
          </DrawerTitle>
        </DrawerHeader>
        <ValidatedForm
          action={
            isEditing
              ? path.to.procedureParameter(procedureId, initialValues.id!)
              : path.to.newProcedureParameter(procedureId)
          }
          method="post"
          validator={procedureParameterValidator}
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="procedureId" />
            <VStack>
              <Input name="key" label="Key" isDisabled={isDisabled} />
              <Input name="value" label="Value" isDisabled={isDisabled} />
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

function DeleteProcedureParameter({
  parameter,
  onCancel,
}: {
  parameter: ProcedureParameter;
  onCancel: () => void;
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  if (!parameter.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteProcedureParameter(id, parameter.id)}
      name={parameter.key ?? "this parameter"}
      text={`Are you sure you want to delete the parameter: ${parameter.key}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}
