import { useCarbon } from "@carbon/auth";
import {
  Array as ArrayInput,
  Hidden,
  Input,
  Number,
  SelectControlled,
  Submit,
  ValidatedForm
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
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDebounce,
  useDisclosure,
  useKeyboardShortcuts,
  usePrettifyShortcut,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getCompanyPrivateBucket } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { Reorder, useDragControls } from "framer-motion";
import { nanoid } from "nanoid";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuMaximize2,
  LuMinimize2,
  LuPencil,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod";
import { Empty } from "~/components";
import { UnitOfMeasure } from "~/components/Form";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { qualityDocumentStepValidator } from "~/modules/quality/quality.models";
import { procedureStepType } from "~/modules/shared";
import { getPrivateUrl, path } from "~/utils/path";
import type { QualityDocument, QualityDocumentStep } from "../../types";

export default function QualityDocumentExplorer() {
  const prettifyShortcut = usePrettifyShortcut();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const documentData = useRouteData<{
    document: QualityDocument;
    versions: QualityDocument[];
  }>(path.to.qualityDocument(id));
  const permissions = usePermissions();
  const sortOrderFetcher = useFetcher<{
    success: boolean;
  }>();

  const stepDisclosure = useDisclosure();
  const deleteStepDisclosure = useDisclosure();

  const [selectedStep, setSelectedStep] = useState<QualityDocumentStep | null>(
    null
  );

  const steps = useMemo(
    () => documentData?.document.qualityDocumentStep ?? [],
    [documentData]
  );

  const maxSortOrder =
    steps.reduce((acc, attr) => Math.max(acc, attr.sortOrder), 0) ?? 0;

  const qualityDocumentStepInitialValues = {
    id: selectedStep?.id,
    qualityDocumentId: id,
    name: selectedStep?.name ?? "",
    description: selectedStep?.description ?? {},
    type: selectedStep?.type ?? "Task",
    sortOrder: selectedStep?.sortOrder ?? maxSortOrder + 1,
    unitOfMeasureCode: selectedStep?.unitOfMeasureCode ?? "",
    minValue: selectedStep ? (selectedStep?.minValue ?? undefined) : 0,
    maxValue: selectedStep ? (selectedStep?.maxValue ?? undefined) : 0,
    listValues: selectedStep?.listValues ?? []
  };

  const isDisabled = documentData?.document?.status !== "Draft";

  const [sortOrder, setSortOrder] = useState<string[]>(
    Array.isArray(steps)
      ? steps.sort((a, b) => a.sortOrder - b.sortOrder).map((attr) => attr.id)
      : []
  );

  useEffect(() => {
    if (Array.isArray(steps)) {
      const sorted = [...steps]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((attr) => attr.id);
      setSortOrder(sorted);
    }
  }, [steps]);

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
        action: path.to.qualityDocumentStepOrder(id)
      });
    },
    2500,
    true
  );

  const onDeleteStep = (step: QualityDocumentStep) => {
    if (isDisabled) return;
    setSelectedStep(step);
    deleteStepDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedStep(null);
    deleteStepDisclosure.onClose();
  };

  const onEditAttribute = (attribute: QualityDocumentStep) => {
    if (isDisabled) return;
    flushSync(() => {
      setSelectedStep(attribute);
    });
    stepDisclosure.onOpen();
  };

  const newStepRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+a": (event: KeyboardEvent) => {
      event.stopPropagation();
      if (!isDisabled) {
        newStepRef.current?.click();
      }
    }
  });

  const stepMap = useMemo(
    () =>
      steps.reduce<Record<string, QualityDocumentStep>>(
        (acc, attr) => ({ ...acc, [attr.id]: attr }),
        {}
      ) ?? {},
    [steps]
  );
  return (
    <>
      <VStack className="w-full h-[calc(100dvh-99px)] justify-between">
        <VStack
          className="w-full flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {steps && steps.length > 0 ? (
            <Reorder.Group
              axis="y"
              values={sortOrder}
              onReorder={onReorder}
              className="w-full"
              disabled={isDisabled}
            >
              {sortOrder.map((sortId) => (
                <DraggableStepItem
                  key={sortId}
                  stepId={sortId}
                  isDisabled={isDisabled}
                >
                  {(dragControls) => (
                    <QualityDocumentStepItem
                      isDisabled={isDisabled}
                      attribute={stepMap[sortId]}
                      onDelete={onDeleteStep}
                      onEdit={onEditAttribute}
                      dragControls={dragControls}
                    />
                  )}
                </DraggableStepItem>
              ))}
            </Reorder.Group>
          ) : (
            <Empty>
              {permissions.can("update", "quality") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={() => {
                    flushSync(() => {
                      setSelectedStep(null);
                    });
                    stepDisclosure.onOpen();
                  }}
                >
                  <Trans>Add Step</Trans>
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex-none border-t border-border p-4">
          <Tooltip>
            <TooltipTrigger className="w-full">
              <Button
                ref={newStepRef}
                className="w-full"
                isDisabled={isDisabled || !permissions.can("update", "quality")}
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={() => {
                  flushSync(() => {
                    setSelectedStep(null);
                  });
                  stepDisclosure.onOpen();
                }}
              >
                <Trans>Add Step</Trans>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>
                <span>
                  <Trans>Add Step</Trans>
                </span>
                <Kbd>{prettifyShortcut("Command+Shift+a")}</Kbd>
              </HStack>
            </TooltipContent>
          </Tooltip>
        </div>
      </VStack>
      {stepDisclosure.isOpen && (
        <QualityDocumentStepForm
          // @ts-ignore
          initialValues={qualityDocumentStepInitialValues}
          isDisabled={isDisabled}
          onClose={stepDisclosure.onClose}
        />
      )}
      {deleteStepDisclosure.isOpen && selectedStep && (
        <DeleteQualityDocumentStep
          attribute={selectedStep}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
}

function DraggableStepItem({
  stepId,
  isDisabled,
  children
}: {
  stepId: string;
  isDisabled: boolean;
  children: (dragControls: DragControls) => ReactNode;
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      key={stepId}
      value={stepId}
      dragListener={false}
      dragControls={dragControls}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

type QualityDocumentStepProps = {
  attribute: QualityDocumentStep;
  isDisabled: boolean;
  onEdit: (attribute: QualityDocumentStep) => void;
  onDelete: (attribute: QualityDocumentStep) => void;
  dragControls?: DragControls;
};

function QualityDocumentStepItem({
  attribute,
  isDisabled,
  onEdit,
  onDelete,
  dragControls
}: QualityDocumentStepProps) {
  const { t } = useLingui();
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
        aria-label={t`Drag handle`}
        icon={<LuGripVertical />}
        variant="ghost"
        disabled={isDisabled}
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          if (!isDisabled && dragControls) dragControls.start(e);
        }}
        style={{ touchAction: "none" }}
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
                aria-label={t`More`}
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
                <Trans>Edit Step</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={!permissions.can("update", "quality")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(attribute);
                }}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                <Trans>Delete Step</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </HStack>
  );
}

function DeleteQualityDocumentStep({
  attribute,
  onCancel
}: {
  attribute: QualityDocumentStep;
  onCancel: () => void;
}) {
  const { id } = useParams();
  if (!id) throw new Error("id not found");
  if (!attribute.id) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteQualityDocumentStep(id, attribute.id)}
      name={attribute.name ?? "this attribute"}
      text={`Are you sure you want to delete the attribute: ${attribute.name}? This cannot be undone.`}
      onCancel={onCancel}
      onSubmit={onCancel}
    />
  );
}

function QualityDocumentStepForm({
  initialValues,
  isDisabled,
  onClose
}: {
  initialValues: z.infer<typeof qualityDocumentStepValidator>;
  isDisabled: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { id: qualityDocumentId } = useParams();
  if (!qualityDocumentId) throw new Error("id not found");

  const [type, setType] = useState<QualityDocumentStep["type"]>(
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
    company: { id: companyId }
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
        value: type
      })),
    []
  );

  const isEditing = !!initialValues.id;

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage
      .from(getCompanyPrivateBucket(companyId))
      .upload(fileName, file);

    if (result?.error) {
      toast.error(t`Failed to upload image`);
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
              ? path.to.qualityDocumentStep(
                  qualityDocumentId,
                  initialValues.id!
                )
              : path.to.newQualityDocumentStep(qualityDocumentId)
          }
          defaultValues={initialValues}
          validator={qualityDocumentStepValidator}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? t`Edit Step` : t`Add Step`}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="qualityDocumentId" />
            <Hidden name="sortOrder" />
            <Hidden name="id" />
            <Hidden name="description" value={JSON.stringify(description)} />
            <VStack spacing={4}>
              <SelectControlled
                name="type"
                label={t`Type`}
                options={typeOptions}
                value={type}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as QualityDocumentStep["type"]);
                  }
                }}
              />
              <Input name="name" label={t`Name`} />
              <VStack spacing={2} className="w-full">
                <Label>
                  <Trans>Description</Trans>
                </Label>
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
                    label={t`Unit of Measure`}
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
                      label={t`Minimum`}
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10
                      }}
                    />
                  )}
                  {numericControls.includes("max") && (
                    <Number
                      name="maxValue"
                      label={t`Maximum`}
                      formatOptions={{
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 10
                      }}
                    />
                  )}
                </>
              )}
              {type === "List" && (
                <ArrayInput name="listValues" label={t`List Options`} />
              )}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit isDisabled={isDisabled}>
              <Trans>Save</Trans>
            </Submit>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}
