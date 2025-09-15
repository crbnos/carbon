import { useCarbon } from "@carbon/auth";
import {
  Array as ArrayInput,
  Hidden,
  Input,
  Number,
  SelectControlled,
  Submit,
  ValidatedForm,
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Kbd,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDebounce,
  useDisclosure,
  useKeyboardShortcuts,
  VStack,
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { useFetcher, useParams } from "@remix-run/react";
import { Reorder } from "framer-motion";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuActivity,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuMaximize2,
  LuMinimize2,
  LuPencil,
  LuTrash,
} from "react-icons/lu";
import type { z } from "zod";
import { Empty } from "~/components";
import { UnitOfMeasure } from "~/components/Form";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { procedureStepType } from "~/modules/shared";
import { getPrivateUrl, path } from "~/utils/path";
import {
  procedureParameterValidator,
  procedureStepValidator,
} from "../../production.models";
import type { Procedure, ProcedureParameter, ProcedureStep } from "../../types";

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

  const procedureStepDisclosure = useDisclosure();
  const deleteAttributeDisclosure = useDisclosure();
  const procedureParameterDisclosure = useDisclosure();
  const deleteParameterDisclosure = useDisclosure();

  const [selectedAttribute, setSelectedAttribute] =
    useState<ProcedureStep | null>(null);
  const [selectedParameter, setSelectedParameter] =
    useState<ProcedureParameter | null>(null);

  const attributes = useMemo(
    () => procedureData?.procedure.procedureStep ?? [],
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
    description: selectedAttribute?.description ?? {},
    type: selectedAttribute?.type ?? "Task",
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
        action: path.to.procedureStepOrder(id),
      });
    },
    2500,
    true
  );

  const onDeleteAttribute = (attribute: ProcedureStep) => {
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

  const onEditAttribute = (attribute: ProcedureStep) => {
    if (isDisabled) return;
    flushSync(() => {
      setSelectedAttribute(attribute);
    });
    procedureStepDisclosure.onOpen();
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
      attributes.reduce<Record<string, ProcedureStep>>(
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
              <TabsTrigger value="attributes">Steps</TabsTrigger>
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
                      <ProcedureStepItem
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
                        procedureStepDisclosure.onOpen();
                      }}
                    >
                      Add Step
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
                      procedureStepDisclosure.onOpen();
                    }}
                  >
                    Add Step
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <HStack>
                    <span>Add Step</span>
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
      {procedureStepDisclosure.isOpen && (
        <ProcedureStepForm
          // @ts-ignore
          initialValues={procedureAttribtueInitialValues}
          isDisabled={isDisabled}
          onClose={procedureStepDisclosure.onClose}
        />
      )}
      {deleteAttributeDisclosure.isOpen && selectedAttribute && (
        <DeleteProcedureStep
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

type ProcedureStepProps = {
  attribute: ProcedureStep;
  isDisabled: boolean;
  onEdit: (attribute: ProcedureStep) => void;
  onDelete: (attribute: ProcedureStep) => void;
};

function ProcedureStepItem({
  attribute,
  isDisabled,
  onEdit,
  onDelete,
}: ProcedureStepProps) {
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
              <ProcedureStepTypeIcon
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
            </HStack>
            {(attribute.minValue !== null || attribute.maxValue !== null) && (
              <p className="text-muted-foreground text-xs">
                {attribute.minValue !== null && attribute.maxValue !== null
                  ? `Must be between ${attribute.minValue} and ${attribute.maxValue}`
                  : attribute.minValue !== null
                  ? `Must be > ${attribute.minValue}`
                  : attribute.maxValue !== null
                  ? `Must be < ${attribute.maxValue}`
                  : null}
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
                Edit Step
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
                Delete Step
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </HStack>
  );
}

function DeleteProcedureStep({
  attribute,
  onCancel,
}: {
  attribute: ProcedureStep;
  onCancel: () => void;
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  if (!attribute.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteProcedureStep(id, attribute.id)}
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
function ProcedureStepForm({
  initialValues,
  isDisabled,
  onClose,
}: {
  initialValues: z.infer<typeof procedureStepValidator>;
  isDisabled: boolean;
  onClose: () => void;
}) {
  const { id: procedureId } = useParams();
  if (!procedureId) throw new Error("id not found");

  const [type, setType] = useState<ProcedureStep["type"]>(initialValues.type);

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

  // Fix for JSON parsing error - safely parse description or use empty object
  const [description, setDescription] = useState<JSONContent>(() => {
    try {
      // Handle both string and object cases
      if (typeof initialValues.description === "string") {
        return JSON.parse(initialValues.description || "{}") as JSONContent;
      } else if (
        initialValues.description &&
        typeof initialValues.description === "object"
      ) {
        return initialValues.description as JSONContent;
      }
      return {} as JSONContent;
    } catch (e) {
      console.error("Error parsing description:", e);
      return {} as JSONContent;
    }
  });

  const { carbon } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

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
      procedureStepType.map((type) => ({
        label: (
          <HStack>
            <ProcedureStepTypeIcon type={type} className="mr-2" />
            {type}
          </HStack>
        ),
        value: type,
      })),
    []
  );

  const isEditing = !!initialValues.id;

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

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
              ? path.to.procedureStep(procedureId, initialValues.id!)
              : path.to.newProcedureStep(procedureId)
          }
          defaultValues={initialValues}
          validator={procedureStepValidator}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit Step" : "Add Step"}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="procedureId" />
            <Hidden name="sortOrder" />
            <Hidden name="id" />
            <Hidden name="description" value={JSON.stringify(description)} />
            <VStack spacing={4}>
              <SelectControlled
                name="type"
                label="Type"
                options={typeOptions}
                value={type}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as ProcedureStep["type"]);
                  }
                }}
              />
              <Input name="name" label="Name" />
              <VStack spacing={2} className="w-full">
                <Label>Description</Label>
                <Editor
                  initialValue={description}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setDescription(value);
                  }}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
                />
              </VStack>
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
