"use client";
import { useCarbon } from "@carbon/auth";
import { Array as ArrayInput, Input, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Count,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  generateHTML,
  HStack,
  IconButton,
  Label,
  Loading,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useDebounce,
  useDisclosure,
  useThrottle,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DragControls } from "framer-motion";
import { motion, Reorder, useDragControls } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuActivity,
  LuChevronLeft,
  LuChevronRight,
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
  LuHammer,
  LuInfo,
  LuList,
  LuListChecks,
  LuLock,
  LuMaximize2,
  LuMinimize2,
  LuSquareFunction,
  LuTriangleAlert
} from "react-icons/lu";
import {
  useFetcher,
  useFetchers,
  useParams,
  useRevalidator
} from "react-router";
import { z } from "zod";
import {
  DirectionAwareTabs,
  EmployeeAvatar,
  Empty,
  TimeTypeIcon
} from "~/components";
import { ConfigurationEditor } from "~/components/Configurator/ConfigurationEditor";
import type { Configuration } from "~/components/Configurator/types";
import {
  Hidden,
  InputControlled,
  Number,
  NumberControlled,
  Process,
  Select,
  SelectControlled,
  StandardFactor,
  Submit,
  SupplierProcess,
  Tags,
  Tool,
  UnitHint,
  UnitOfMeasure,
  WorkCenter
} from "~/components/Form";
import AssemblyInstruction from "~/components/Form/AssemblyInstruction";
import InspectionDocument from "~/components/Form/InspectionDocument";
import Procedure from "~/components/Form/Procedure";
import { SupplierProcessPreview } from "~/components/Form/SupplierProcess";
import { getUnitHint } from "~/components/Form/UnitHint";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { OperationTypeIcon, ProcedureStepTypeIcon } from "~/components/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { SlidesEditor, uploadStepSlideModel } from "~/components/SlidesEditor";
import type { Item, SortableItemRenderProps } from "~/components/SortableList";
import {
  SortableList,
  SortableListItem,
  SortableListItemPanel,
  SortableListItemToggle
} from "~/components/SortableList";
import { StepLinkEditor } from "~/components/StepLinkEditor";
import { useDateFormatter, usePermissions, useUser } from "~/hooks";
import { useTags } from "~/hooks/useTags";
import type {
  OperationParameter,
  OperationStep,
  OperationStepSlide,
  OperationTool,
  SlideAnnotation,
  SlideSize
} from "~/modules/shared";
import {
  methodOperationOrders,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
  operationTypes,
  procedureStepType,
  standardFactorType
} from "~/modules/shared";
import type { action as editMethodOperationParameterAction } from "~/routes/x+/items+/methods+/operation.parameter.$id";
import type { action as newMethodOperationParameterAction } from "~/routes/x+/items+/methods+/operation.parameter.new";
import type { action as editMethodOperationStepAction } from "~/routes/x+/items+/methods+/operation.step.$id";
import type { action as editMethodOperationToolAction } from "~/routes/x+/items+/methods+/operation.tool.$id";
import type { action as newMethodOperationToolAction } from "~/routes/x+/items+/methods+/operation.tool.new";
import { useItems, useTools } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import { methodOperationValidator } from "../../items.models";
import type {
  ConfigurationParameter,
  ConfigurationRule,
  MakeMethod
} from "../../types";
import type { ReleaseLockProps } from "./ReleaseLockAlert";
import ReleaseLockAlert, { getReleaseLockFlags } from "./ReleaseLockAlert";

type Operation = z.infer<typeof methodOperationValidator> & {
  workInstruction: JSONContent | null;
  tags: string[];
};

type ItemWithData = Item & {
  data: Operation;
};

type MethodMaterialType = {
  id: string;
  itemId: string;
  description?: string | null;
  quantity?: number | null;
  methodOperationId?: string | null;
  methodMaterialStep?: { methodOperationStepId: string }[] | null;
};

type BillOfProcessProps = {
  configurable?: boolean;
  configurationRules?: ConfigurationRule[];
  makeMethod: MakeMethod;
  materials: MethodMaterialType[];
  operations: (Operation & {
    methodOperationTool: OperationTool[];
    methodOperationParameter: OperationParameter[];
    methodOperationStep: OperationStep[];
  })[];
  parameters?: ConfigurationParameter[];
  tags: { name: string }[];
  selectedMaterialId?: string;
} & ReleaseLockProps;

type PendingWorkInstructions = {
  [key: string]: JSONContent;
};

type OrderState = {
  [key: string]: number;
};

type CheckedState = {
  [key: string]: boolean;
};

type TemporaryItems = {
  [key: string]: Operation;
};

const initialOperation: Omit<
  Operation,
  "makeMethodId" | "order" | "tools" | "id"
> = {
  description: "",
  laborTime: 0,
  laborUnit: "Minutes/Piece",
  machineTime: 0,
  machineUnit: "Minutes/Piece",
  operationOrder: "After Previous",
  operationType: "Process",
  assemblyInstructionId: "",
  inspectionDocumentId: "",
  processId: "",
  procedureId: "",
  setupTime: 0,
  setupUnit: "Total Minutes",
  tags: [],
  workCenterId: "",
  workInstruction: {},
  operationMinimumCost: 0,
  operationLeadTime: 0,
  operationUnitCost: 0
};

const BillOfProcess = ({
  configurable = false,
  configurationRules,
  makeMethod,
  materials,
  operations: initialOperations,
  parameters,
  tags,
  selectedMaterialId,
  revisionStatus,
  releaseControl
}: BillOfProcessProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { isProductionRevision, isReleaseLocked } = getReleaseLockFlags({
    revisionStatus,
    releaseControl
  });
  const isReadOnly =
    permissions.can("update", "parts") === false ||
    makeMethod.status !== "Draft" ||
    isReleaseLocked;

  const makeMethodId = makeMethod.id;

  const { carbon } = useCarbon();
  const sortOrderFetcher = useFetcher<{}>();
  const deleteOperationFetcher = useFetcher<{ success: boolean }>();
  const { id: userId } = useUser();

  const [allItems] = useItems();

  const materialItemIds = useMemo(
    () => new Set((materials ?? []).map((m) => m.itemId)),
    [materials]
  );

  const itemMentions = useMemo(
    () =>
      allItems
        .filter((item) => materialItemIds.has(item.id))
        .map((item) => ({
          id: item.id,
          label: item.name ?? item.readableIdWithRevision,
          helper: item.name ? item.readableIdWithRevision : undefined
        })),
    [allItems, materialItemIds]
  );

  const addOperationButtonRef = useRef<HTMLButtonElement>(null);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [temporaryItems, setTemporaryItems] = useState<TemporaryItems>({});
  const [workInstructions, setWorkInstructions] =
    useState<PendingWorkInstructions>(() => {
      return initialOperations.reduce((acc, operation) => {
        if (operation.workInstruction) {
          acc[operation.id!] = operation.workInstruction;
        }
        return acc;
      }, {} as PendingWorkInstructions);
    });
  const [checkedState, setCheckedState] = useState<CheckedState>({});
  const [orderState, setOrderState] = useState<OrderState>(() => {
    return initialOperations.reduce((acc, op) => {
      acc[op.id!] = op.order;
      return acc;
    }, {} as OrderState);
  });

  const operationsById = new Map<
    string,
    Operation & { methodOperationTool: OperationTool[] }
  >();

  // Add initial operations to map
  initialOperations.forEach((operation) => {
    if (!operation.id) return;
    operationsById.set(operation.id, operation);
  });

  const pendingOperations = usePendingOperations();

  // Replace existing operations with pending ones
  pendingOperations.forEach((pendingOperation) => {
    if (!pendingOperation.id) {
      operationsById.set("temporary", {
        ...pendingOperation,
        workInstruction: {},
        methodOperationTool: [],
        tags: []
      });
      return;
    }

    // Remove existing operation if it exists
    operationsById.delete(pendingOperation.id);

    // Add pending operation
    operationsById.set(pendingOperation.id, {
      ...pendingOperation,
      workInstruction: workInstructions[pendingOperation.id] || null,
      order: orderState[pendingOperation.id] ?? pendingOperation.order,
      methodOperationTool: [],
      tags: []
    });
  });

  // Add temporary items to operations
  Object.entries(temporaryItems).forEach(([id, operation]) => {
    if (!operationsById.has(id)) {
      operationsById.set(id, {
        ...operation,
        methodOperationTool: []
      });
    }
  });

  const operations = Array.from(operationsById.values()).sort(
    (a, b) => (orderState[a.id!] ?? a.order) - (orderState[b.id!] ?? b.order)
  );

  const items = makeItems(operations, tags).map((item) => ({
    ...item,
    checked: checkedState[item.id] ?? false
  }));

  const onUpdateWorkInstruction = useDebounce(
    async (id: string, content: JSONContent) => {
      if (!temporaryItems[id]) {
        await carbon
          ?.from("methodOperation")
          .update({
            workInstruction: content,
            updatedAt: today(getLocalTimeZone()).toString(),
            updatedBy: userId
          })
          .eq("id", id);
      }
    },
    1000,
    true
  );

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${selectedItemId}/${nanoid()}.${fileType}`;
    const result = await carbon?.storage
      .from("private")
      .upload(fileName, file, {
        upsert: true,
        cacheControl: "3600"
      });

    if (result?.error) {
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const onToggleItem = (id: string) => {
    if (isReadOnly) return;
    setCheckedState((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const onReorder = (items: ItemWithData[]) => {
    if (isReadOnly) return;

    // Create new order state
    const newOrderState = items.reduce<OrderState>((acc, item, index) => {
      acc[item.id] = index + 1;
      return acc;
    }, {});

    // Update order state immediately
    setOrderState(newOrderState);

    // Only send saved items to the server (exclude temporary items)
    const updates = Object.entries(newOrderState).reduce<
      Record<string, number>
    >((acc, [id, order]) => {
      if (!temporaryItems[id]) {
        acc[id] = order;
      }
      return acc;
    }, {});

    updateSortOrder(updates);
  };

  const updateSortOrder = useThrottle(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, {
        method: "post",
        action: path.to.methodOperationsOrder
      });
    },
    1000,
    true
  );

  const onAddItem = () => {
    const operationId = nanoid();

    let newOrder = 1;
    if (operations.length) {
      newOrder = Math.max(...operations.map((op) => op.order)) + 1;
    }

    const newOperation: Operation = {
      ...initialOperation,
      id: operationId,
      order: newOrder,
      makeMethodId
    };

    setTemporaryItems((prev) => ({
      ...prev,
      [operationId]: newOperation
    }));
    setSelectedItemId(operationId);
  };

  const onRemoveItem = async (id: string) => {
    if (isReadOnly) return;

    const operation = operationsById.get(id);
    if (!operation) return;

    // Check if this is a temporary item (exists in temporaryItems state)
    if (temporaryItems[id]) {
      setTemporaryItems((prev) => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } else {
      deleteOperationFetcher.submit(
        { id },
        {
          method: "post",
          action: path.to.methodOperationsDelete
        }
      );
    }

    setSelectedItemId(null);
    setOrderState((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  const {
    company: { id: companyId }
  } = useUser();

  const [tabChangeRerender, setTabChangeRerender] = useState<number>(1);
  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedItemId;
    const tools =
      initialOperations.find((o) => o.id === item.id)?.methodOperationTool ??
      [];
    const parameters =
      initialOperations.find((o) => o.id === item.id)
        ?.methodOperationParameter ?? [];
    const steps =
      initialOperations.find((o) => o.id === item.id)?.methodOperationStep ??
      [];

    const hasProcedure = !!item.data.procedureId;
    const hasAssemblyInstruction = !!item.data.assemblyInstructionId;
    const hasInspectionDocument = !!item.data.inspectionDocumentId;

    const tabs = [
      {
        id: 0,
        label: t`Details`,
        content: (
          <div className="flex w-full flex-col pr-2 py-2">
            <OperationForm
              isReadOnly={isReadOnly}
              configurable={configurable}
              item={item}
              itemId={makeMethod.itemId}
              rulesByField={rulesByField}
              workInstruction={workInstructions[item.id] ?? {}}
              temporaryItems={temporaryItems}
              onConfigure={onConfigure}
              setSelectedItemId={setSelectedItemId}
              setTemporaryItems={setTemporaryItems}
              setWorkInstructions={setWorkInstructions}
              onSubmit={() => {
                setSelectedItemId(null);
                addOperationButtonRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                  inline: "center"
                });
              }}
            />
          </div>
        )
      },
      {
        id: 1,
        label: (
          <span className="flex items-center gap-2">
            Instructions
            {hasProcedure && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary">
                    <LuListChecks />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="opacity-100">
                  <p>
                    <Trans>
                      Instructions are inherited from the procedure.
                    </Trans>
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        ),
        disabled:
          item.id in temporaryItems ||
          hasProcedure ||
          item.data.operationType === "Outside Processing",
        content: (
          <div className="flex flex-col">
            <div>
              {!isReadOnly ? (
                <Editor
                  initialValue={
                    workInstructions[item.id] ?? ({} as JSONContent)
                  }
                  onUpload={onUploadImage}
                  onChange={(content) => {
                    if (isReadOnly) return;
                    setWorkInstructions((prev) => ({
                      ...prev,
                      [item.id]: content
                    }));
                    onUpdateWorkInstruction(item.id, content);
                  }}
                  mentions={[{ char: "@", items: itemMentions }]}
                  className="py-8"
                />
              ) : (
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(
                      item.data.workInstruction ?? ({} as JSONContent)
                    )
                  }}
                />
              )}
            </div>
          </div>
        )
      },
      {
        id: 2,
        disabled:
          item.id in temporaryItems ||
          hasProcedure ||
          item.data.operationType === "Outside Processing",
        label: (
          <span className="flex items-center gap-2">
            <span>Parameters</span>
            {hasProcedure && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary">
                    <LuListChecks />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="opacity-100">
                  <p>
                    <Trans>Parameters are inherited from the procedure.</Trans>
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {!hasProcedure && parameters.length > 0 && (
              <Count count={parameters.length} />
            )}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <ParametersForm
              parameters={parameters}
              operationId={item.id!}
              temporaryItems={temporaryItems}
              isDisabled={
                isReadOnly ||
                selectedItemId === null ||
                (selectedItemId !== null && !!temporaryItems[selectedItemId])
              }
              configurable={configurable}
              rulesByField={rulesByField}
              onConfigure={onConfigure}
            />
          </div>
        )
      },
      {
        id: 3,
        disabled:
          item.id in temporaryItems ||
          hasProcedure ||
          hasAssemblyInstruction ||
          hasInspectionDocument ||
          item.data.operationType === "Outside Processing",
        label: (
          <span className="flex items-center gap-2">
            <span>Steps</span>
            {(hasProcedure ||
              hasAssemblyInstruction ||
              hasInspectionDocument) && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="secondary">
                    <LuListChecks />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="opacity-100">
                  <p>
                    {hasAssemblyInstruction ? (
                      <Trans>
                        Steps are inherited from the assembly instruction.
                      </Trans>
                    ) : hasInspectionDocument ? (
                      <Trans>
                        Steps are inherited from the inspection plan.
                      </Trans>
                    ) : (
                      <Trans>
                        Attributes are inherited from the procedure.
                      </Trans>
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {!hasProcedure &&
              !hasAssemblyInstruction &&
              !hasInspectionDocument &&
              steps.length > 0 && <Count count={steps.length} />}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <AttributesForm
              steps={steps}
              tools={tools}
              materials={materials}
              operationId={item.id!}
              temporaryItems={temporaryItems}
              isDisabled={
                isReadOnly ||
                selectedItemId === null ||
                (selectedItemId !== null && !!temporaryItems[selectedItemId])
              }
              configurable={configurable}
              rulesByField={rulesByField}
              onConfigure={onConfigure}
              itemMentions={itemMentions}
            />
          </div>
        )
      },
      {
        id: 4,
        disabled:
          item.id in temporaryItems ||
          item.data.operationType === "Outside Processing",
        label: (
          <span className="flex items-center gap-2">
            <span>Tools</span>
            {tools.length > 0 && <Count count={tools.length} />}
          </span>
        ),
        content: (
          <div className="flex w-full flex-col py-4">
            <ToolsForm
              tools={tools}
              operationId={item.id!}
              temporaryItems={temporaryItems}
              isDisabled={
                isReadOnly ||
                selectedItemId === null ||
                (selectedItemId !== null && !!temporaryItems[selectedItemId])
              }
            />
          </div>
        )
      },
      {
        // Phase 3: read-only preview of how the operator sees this operation in the MES
        // assembly view — step-by-step, with each step's reference image and the tools
        // scoped to it. No live job needed; renders straight off the method.
        id: 5,
        disabled: item.id in temporaryItems,
        label: <span>Preview</span>,
        content: (
          <div className="flex w-full flex-col py-4">
            <OperationPreview steps={steps} tools={tools} />
          </div>
        )
      }
    ];

    return (
      <SortableListItem<Operation>
        isReadOnly={isReadOnly}
        item={item}
        items={items}
        order={order}
        key={item.id}
        isExpanded={isOpen}
        onSelectItem={setSelectedItemId}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        handleDrag={() => setSelectedItemId(null)}
        renderExtra={(item) => (
          <div>
            <SortableListItemToggle
              isOpen={isOpen}
              onToggle={() => setSelectedItemId(isOpen ? null : item.id)}
            />
            <SortableListItemPanel isOpen={isOpen}>
              <DirectionAwareTabs
                className="mr-auto"
                tabs={tabs}
                onChange={() => setTabChangeRerender(tabChangeRerender + 1)}
              />
            </SortableListItemPanel>
          </div>
        )}
      />
    );
  };

  const configuratorDisclosure = useDisclosure();
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null
  );

  const onConfigure = (c: Configuration) => {
    flushSync(() => {
      setConfiguration(c);
    });
    configuratorDisclosure.onOpen();
  };

  const { materialId: paramMaterialId } = useParams();
  const materialId = selectedMaterialId ?? paramMaterialId;

  const rulesByField = new Map(
    configurationRules?.map((rule) => [rule.field, rule]) ?? []
  );

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle className="flex flex-row items-center gap-2">
            Bill of Process {isReadOnly && <LuLock />}
          </CardTitle>
        </CardHeader>

        <CardAction>
          <div className="flex items-center gap-2">
            <Button
              ref={addOperationButtonRef}
              variant="secondary"
              isDisabled={isReadOnly || selectedItemId !== null}
              onClick={onAddItem}
            >
              <Trans>Add Operation</Trans>
            </Button>
            {configurable && operations.length > 0 && (
              <IconButton
                icon={<LuSquareFunction />}
                aria-label={t`Configure`}
                variant="ghost"
                className={cn(
                  rulesByField.has(
                    `billOfProcess:${makeMethodId}:${materialId}`
                  ) && "text-emerald-500 hover:text-emerald-500"
                )}
                onClick={() =>
                  onConfigure({
                    label: t`Bill of Process`,
                    field: `billOfProcess:${makeMethodId}:${materialId}`,
                    code: rulesByField.get(
                      `billOfProcess:${makeMethodId}:${materialId}`
                    )?.code,
                    returnType: {
                      type: "list",
                      listOptions: operations.map((op) => op.description)
                    }
                  })
                }
              />
            )}
          </div>
        </CardAction>
      </HStack>
      <CardContent>
        {isProductionRevision && (
          <ReleaseLockAlert isLocked={isReleaseLocked} className="mb-4" />
        )}
        <SortableList
          isReadOnly={isReadOnly}
          items={items}
          onReorder={onReorder}
          onToggleItem={onToggleItem}
          onRemoveItem={onRemoveItem}
          renderItem={renderListItem}
        />
      </CardContent>
      {configuratorDisclosure.isOpen && configuration && (
        <ConfigurationEditor
          configuration={configuration}
          open={configuratorDisclosure.isOpen}
          // @ts-ignore
          parameters={parameters ?? []}
          onClose={configuratorDisclosure.onClose}
        />
      )}
    </Card>
  );
};

export default BillOfProcess;

type OperationFormProps = {
  configurable: boolean;
  isReadOnly: boolean;
  item: ItemWithData;
  itemId: string;
  rulesByField: Map<string, ConfigurationRule>;
  workInstruction: JSONContent;
  temporaryItems: TemporaryItems;
  onConfigure: (configuration: Configuration) => void;
  setSelectedItemId: Dispatch<SetStateAction<string | null>>;
  setTemporaryItems: Dispatch<SetStateAction<TemporaryItems>>;
  setWorkInstructions: Dispatch<SetStateAction<PendingWorkInstructions>>;
  onSubmit: () => void;
};

function OperationForm({
  isReadOnly,
  configurable,
  item,
  itemId,
  rulesByField,
  workInstruction,
  temporaryItems,
  onConfigure,
  setSelectedItemId,
  setWorkInstructions,
  setTemporaryItems,
  onSubmit
}: OperationFormProps) {
  const { t } = useLingui();
  const methodOperationFetcher = useFetcher<{
    id: string;
    success: boolean;
    message: string;
  }>();
  const { company } = useUser();
  const { carbon } = useCarbon();

  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  useEffect(() => {
    // Remove from temporary items after successful submission
    if (methodOperationFetcher.data && methodOperationFetcher.data.id) {
      // Clear temporary item after successful save
      setTemporaryItems((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });

      if (methodOperationFetcher.data.success) {
        toast.success(methodOperationFetcher.data.message);
      }
      onSubmit();
    }
  }, [item.id, methodOperationFetcher.data, setTemporaryItems, onSubmit]);

  const machineDisclosure = useDisclosure();
  const laborDisclosure = useDisclosure();
  const assemblyDisclosure = useDisclosure();
  const setupDisclosure = useDisclosure();
  const procedureDisclosure = useDisclosure();

  const [processData, setProcessData] = useState<{
    description: string;
    laborTime: number;
    laborUnit: string;
    laborUnitHint: string;
    machineTime: number;
    machineUnit: string;
    machineUnitHint: string;
    operationType: string;
    assemblyInstructionId: string;
    inspectionDocumentId: string;
    operationOrder: string;
    processId: string;
    procedureId: string;
    workCenterId: string;
    setupTime: number;
    setupUnit: string;
    setupUnitHint: string;
    operationMinimumCost: number;
    operationLeadTime: number;
    operationUnitCost: number;
  }>({
    description: item.data.description ?? "",
    laborTime: item.data.laborTime ?? 0,
    laborUnit: item.data.laborUnit ?? "Hours/Piece",
    laborUnitHint: getUnitHint(item.data.laborUnit),
    machineTime: item.data.machineTime ?? 0,
    machineUnit: item.data.machineUnit ?? "Hours/Piece",
    machineUnitHint: getUnitHint(item.data.machineUnit),
    operationOrder: item.data.operationOrder ?? "After Previous",
    operationType: item.data.operationType ?? "Process",
    assemblyInstructionId: item.data.assemblyInstructionId ?? "",
    inspectionDocumentId: item.data.inspectionDocumentId ?? "",
    processId: item.data.processId ?? "",
    procedureId: item.data.procedureId ?? "",
    workCenterId: item.data.workCenterId ?? "",
    setupTime: item.data.setupTime ?? 0,
    setupUnit: item.data.setupUnit ?? "Total Minutes",
    setupUnitHint: getUnitHint(item.data.setupUnit),
    operationMinimumCost: item.data.operationMinimumCost ?? 0,
    operationLeadTime: item.data.operationLeadTime ?? 0,
    operationUnitCost: item.data.operationUnitCost ?? 0
  });

  const onProcessChange = async (processId: string) => {
    if (!carbon || !processId) return;
    const [process, supplierProcesses] = await Promise.all([
      carbon.from("process").select("*").eq("id", processId).single(),
      carbon.from("supplierProcess").select("*").eq("processId", processId)
    ]);

    if (process.error) throw new Error(process.error.message);

    setProcessData((p) => ({
      ...p,
      processId,
      procedureId: "",
      description: process.data?.name ?? "",
      laborUnit: process.data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(process.data?.defaultStandardFactor),
      machineUnit: process.data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(process.data?.defaultStandardFactor),
      // processType and operationType share one enum — the process's type is the
      // default operation type.
      operationType: process.data?.processType ?? "Process",
      operationMinimumCost:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.minimumCost ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationMinimumCost,
      operationUnitCost: item.data.operationUnitCost ?? 0,
      operationLeadTime:
        supplierProcesses.data && supplierProcesses.data.length > 0
          ? supplierProcesses.data.reduce((acc, sp) => {
              return (acc += sp.leadTime ?? 0);
            }, 0) / supplierProcesses.data.length
          : p.operationLeadTime
    }));
  };

  const onWorkCenterChange = async (workCenterId: string) => {
    if (!carbon || !workCenterId) return;
    const { data, error } = await carbon
      .from("workCenter")
      .select("*")
      .eq("id", workCenterId)
      .single();

    if (error) throw new Error(error.message);

    setProcessData((p) => ({
      ...p,
      workCenterId,
      laborUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      laborUnitHint: getUnitHint(data?.defaultStandardFactor),
      machineUnit: data?.defaultStandardFactor ?? "Hours/Piece",
      machineUnitHint: getUnitHint(data?.defaultStandardFactor)
    }));
  };

  const key = (field: string) => getFieldKey(field, item.id);

  return (
    <ValidatedForm
      action={
        temporaryItems[item.id]
          ? path.to.newMethodOperation
          : path.to.methodOperation(item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={methodOperationValidator}
      className="w-full flex flex-col gap-y-4"
      fetcher={methodOperationFetcher}
    >
      <div>
        <Hidden name="id" />
        <Hidden name="makeMethodId" />
        <Hidden name="order" />
      </div>

      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <Process
          name="processId"
          label={t`Process`}
          isConfigured={rulesByField.has(key("processId"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: t`Process`,
                    field: key("processId"),
                    code: rulesByField.get(key("processId"))?.code,
                    defaultValue: processData.processId,
                    returnType: {
                      type: "text",
                      helperText:
                        "the unique identifier for the process. you can get this from the URL when editing a process"
                    }
                  });
                }
              : undefined
          }
          onChange={(value) => {
            onProcessChange(value?.value as string);
          }}
        />

        <SelectControlled
          name="operationType"
          label={t`Operation Type`}
          termId="operation-type"
          placeholder={t`Operation Type`}
          options={operationTypes.map((o) => ({
            value: o,
            label: (
              <span className="flex items-center gap-2">
                <OperationTypeIcon type={o} />
                <span>{o}</span>
              </span>
            )
          }))}
          value={processData.operationType}
          onChange={(value) => {
            const next = (value?.value as string) ?? "Process";
            setProcessData((d) => ({
              ...d,
              operationType: next,
              // Each type has exactly one instruction source — clear the ones
              // that no longer apply (the upsert normalizes server-side too).
              ...(next !== "Process" ? { procedureId: "" } : {}),
              ...(next !== "Assembly" ? { assemblyInstructionId: "" } : {}),
              ...(next !== "Inspection" ? { inspectionDocumentId: "" } : {}),
              // Machine only applies to Process operations.
              ...(next !== "Process" ? { machineTime: 0 } : {}),
              // Crossing the in-house <-> Outside Processing boundary changes the
              // meaningful time units; reset to defaults. Switching between in-house
              // types keeps whatever units the user picked.
              ...((next === "Outside Processing") !==
              (d.operationType === "Outside Processing")
                ? {
                    setupUnit: "Total Minutes",
                    laborUnit: "Minutes/Piece",
                    machineUnit: "Minutes/Piece"
                  }
                : {})
            }));
          }}
        />

        {processData.operationType === "Outside Processing" ? (
          <>
            <SupplierProcess
              name="operationSupplierProcessId"
              label={t`Supplier`}
              processId={processData.processId}
              isOptional
            />
            <NumberControlled
              name="operationMinimumCost"
              label={t`Minimum Cost`}
              minValue={0}
              value={processData.operationMinimumCost}
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationMinimumCost: newValue
                }))
              }
            />
            <NumberControlled
              name="operationUnitCost"
              label={t`Unit Cost`}
              minValue={0}
              value={processData.operationUnitCost}
              formatOptions={{
                style: "currency",
                currency: baseCurrency
              }}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationUnitCost: newValue
                }))
              }
            />
            <NumberControlled
              name="operationLeadTime"
              label={t`Lead Time`}
              minValue={0}
              value={processData.operationLeadTime}
              onChange={(newValue) =>
                setProcessData((d) => ({
                  ...d,
                  operationLeadTime: newValue
                }))
              }
            />
          </>
        ) : (
          <>
            <WorkCenter
              name="workCenterId"
              label={t`Work Center`}
              termId="work-center"
              isOptional
              processId={processData.processId}
              isConfigured={rulesByField.has(key("workCenterId"))}
              onConfigure={
                configurable && !temporaryItems[item.id]
                  ? () => {
                      onConfigure({
                        label: t`Work Center`,
                        field: key("workCenterId"),
                        code: rulesByField.get(key("workCenterId"))?.code,
                        defaultValue: processData.workCenterId,
                        returnType: {
                          type: "text",
                          helperText:
                            "the unique identifier for the work center. you can get this from the URL when editing a work center"
                        }
                      });
                    }
                  : undefined
              }
              onChange={(value) => {
                if (value) {
                  onWorkCenterChange(value?.value as string);
                }
              }}
            />
          </>
        )}

        <InputControlled
          name="description"
          label={t`Description`}
          value={processData.description}
          onChange={(newValue) => {
            setProcessData((d) => ({ ...d, description: newValue }));
          }}
          className="col-span-2"
          isConfigured={rulesByField.has(key("description"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: t`Description`,
                    field: key("description"),
                    code: rulesByField.get(key("description"))?.code,
                    defaultValue: processData.description,
                    returnType: {
                      type: "text"
                    }
                  });
                }
              : undefined
          }
        />

        <Select
          name="operationOrder"
          label={t`Operation Order`}
          placeholder={t`Operation Order`}
          options={methodOperationOrders.map((o) => ({
            value: o,
            label: o
          }))}
          onChange={(value) => {
            setProcessData((d) => ({
              ...d,
              operationOrder: value?.value as string
            }));
          }}
          isConfigured={rulesByField.has(key("operationOrder"))}
          onConfigure={
            configurable && !temporaryItems[item.id]
              ? () => {
                  onConfigure({
                    label: t`Operation Order`,
                    field: key("operationOrder"),
                    code: rulesByField.get(key("operationOrder"))?.code,
                    defaultValue: processData.operationOrder,
                    returnType: {
                      type: "enum",
                      listOptions: ["After Previous", "With Previous"]
                    }
                  });
                }
              : undefined
          }
        />
      </div>

      {processData.operationType !== "Outside Processing" && (
        <>
          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={setupDisclosure.onToggle}
            >
              <HStack>
                <TimeTypeIcon type="Setup" />
                <Label>
                  <Trans>Setup</Trans>
                </Label>
              </HStack>
              <HStack>
                {(processData.setupTime ?? 0) > 0 && (
                  <Badge variant="secondary">
                    <TimeTypeIcon type="Setup" className="h-3 w-3 mr-1" />
                    {processData.setupTime} {processData.setupUnit}
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronRight />}
                  aria-label={
                    setupDisclosure.isOpen ? t`Collapse Setup` : t`Expand Setup`
                  }
                  variant="ghost"
                  size="md"
                  onClick={(e) => {
                    e.stopPropagation();
                    setupDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    setupDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                setupDisclosure.isOpen ? "" : "hidden"
              }`}
            >
              <UnitHint
                name="setupHint"
                label={t`Setup`}
                value={processData.setupUnitHint}
                onChange={(hint) => {
                  setProcessData((d) => ({
                    ...d,
                    setupUnitHint: hint,
                    setupUnit:
                      hint === "Fixed" ? "Total Minutes" : "Minutes/Piece"
                  }));
                }}
              />
              <NumberControlled
                name="setupTime"
                label={t`Setup Time`}
                isOptional={false}
                minValue={0}
                value={processData.setupTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    setupTime: newValue
                  }))
                }
                isConfigured={rulesByField.has(key("setupTime"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: t`Setup Time`,
                          field: key("setupTime"),
                          code: rulesByField.get(key("setupTime"))?.code,
                          defaultValue: processData.setupTime,
                          returnType: {
                            type: "numeric"
                          }
                        });
                      }
                    : undefined
                }
              />
              <StandardFactor
                name="setupUnit"
                label={t`Setup Unit`}
                isOptional={false}
                hint={processData.setupUnitHint}
                value={processData.setupUnit}
                onChange={(newValue) => {
                  setProcessData((d) => ({
                    ...d,
                    setupUnit: newValue?.value ?? "Total Minutes"
                  }));
                }}
                isConfigured={rulesByField.has(key("setupUnit"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: t`Setup Unit`,
                          field: key("setupUnit"),
                          code: rulesByField.get(key("setupUnit"))?.code,
                          defaultValue: processData.setupUnit,
                          returnType: {
                            type: "enum",
                            listOptions: standardFactorType
                          }
                        });
                      }
                    : undefined
                }
              />
            </div>
          </div>

          <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
            <HStack
              className="w-full justify-between cursor-pointer"
              onClick={laborDisclosure.onToggle}
            >
              <HStack>
                <TimeTypeIcon type="Labor" />
                <Label>
                  <Trans>Labor</Trans>
                </Label>
              </HStack>
              <HStack>
                {(processData.laborTime ?? 0) > 0 && (
                  <Badge variant="secondary">
                    <TimeTypeIcon type="Labor" className="h-3 w-3 mr-1" />
                    {processData.laborTime} {processData.laborUnit}
                  </Badge>
                )}
                <IconButton
                  icon={<LuChevronRight />}
                  aria-label={
                    laborDisclosure.isOpen ? t`Collapse Labor` : t`Expand Labor`
                  }
                  variant="ghost"
                  size="md"
                  onClick={(e) => {
                    e.stopPropagation();
                    laborDisclosure.onToggle();
                  }}
                  className={`transition-transform ${
                    laborDisclosure.isOpen ? "rotate-90" : ""
                  }`}
                />
              </HStack>
            </HStack>
            <div
              className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                laborDisclosure.isOpen ? "" : "hidden"
              }`}
            >
              <UnitHint
                name="laborHint"
                label={t`Labor`}
                value={processData.laborUnitHint}
                onChange={(hint) => {
                  setProcessData((d) => ({
                    ...d,
                    laborUnitHint: hint,
                    laborUnit:
                      hint === "Fixed" ? "Total Minutes" : "Minutes/Piece"
                  }));
                }}
              />
              <NumberControlled
                name="laborTime"
                label={t`Labor Time`}
                isOptional={false}
                minValue={0}
                value={processData.laborTime}
                onChange={(newValue) =>
                  setProcessData((d) => ({
                    ...d,
                    laborTime: newValue
                  }))
                }
                isConfigured={rulesByField.has(key("laborTime"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: t`Labor Time`,
                          field: key("laborTime"),
                          code: rulesByField.get(key("laborTime"))?.code,
                          defaultValue: processData.laborTime,
                          returnType: {
                            type: "numeric"
                          }
                        });
                      }
                    : undefined
                }
              />
              <StandardFactor
                name="laborUnit"
                label={t`Labor Unit`}
                isOptional={false}
                hint={processData.laborUnitHint}
                value={processData.laborUnit}
                onChange={(newValue) => {
                  setProcessData((d) => ({
                    ...d,
                    laborUnit: newValue?.value ?? "Total Minutes"
                  }));
                }}
                isConfigured={rulesByField.has(key("laborUnit"))}
                onConfigure={
                  configurable && !temporaryItems[item.id]
                    ? () => {
                        onConfigure({
                          label: t`Labor Unit`,
                          field: key("laborUnit"),
                          code: rulesByField.get(key("laborUnit"))?.code,
                          defaultValue: processData.laborUnit,
                          returnType: {
                            type: "enum",
                            listOptions: standardFactorType
                          }
                        });
                      }
                    : undefined
                }
              />
            </div>
          </div>
          {processData.operationType === "Process" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack
                className="w-full justify-between cursor-pointer"
                onClick={machineDisclosure.onToggle}
              >
                <HStack>
                  <TimeTypeIcon type="Machine" />
                  <Label>
                    <Trans>Machine</Trans>
                  </Label>
                </HStack>
                <HStack>
                  {(processData?.machineTime ?? 0) > 0 && (
                    <Badge variant="secondary">
                      <TimeTypeIcon type="Machine" className="h-3 w-3 mr-1" />
                      {processData.machineTime} {processData.machineUnit}
                    </Badge>
                  )}
                  <IconButton
                    icon={<LuChevronRight />}
                    aria-label={
                      machineDisclosure.isOpen
                        ? t`Collapse Machine`
                        : t`Expand Machine`
                    }
                    variant="ghost"
                    size="md"
                    onClick={(e) => {
                      e.stopPropagation();
                      machineDisclosure.onToggle();
                    }}
                    className={`transition-transform ${
                      machineDisclosure.isOpen ? "rotate-90" : ""
                    }`}
                  />
                </HStack>
              </HStack>
              <div
                className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 pb-4 ${
                  machineDisclosure.isOpen ? "" : "hidden"
                }`}
              >
                <UnitHint
                  name="machineHint"
                  label={t`Machine`}
                  value={processData.machineUnitHint}
                  onChange={(hint) => {
                    setProcessData((d) => ({
                      ...d,
                      machineUnitHint: hint,
                      machineUnit:
                        hint === "Fixed" ? "Total Minutes" : "Minutes/Piece"
                    }));
                  }}
                />
                <NumberControlled
                  name="machineTime"
                  label={t`Machine Time`}
                  isOptional={false}
                  minValue={0}
                  value={processData.machineTime}
                  onChange={(newValue) =>
                    setProcessData((d) => ({
                      ...d,
                      machineTime: newValue
                    }))
                  }
                  isConfigured={rulesByField.has(key("machineTime"))}
                  onConfigure={
                    configurable && !temporaryItems[item.id]
                      ? () => {
                          onConfigure({
                            label: t`Machine Time`,
                            field: key("machineTime"),
                            code: rulesByField.get(key("machineTime"))?.code,
                            defaultValue: processData.machineTime,
                            returnType: {
                              type: "numeric"
                            }
                          });
                        }
                      : undefined
                  }
                />
                <StandardFactor
                  name="machineUnit"
                  label={t`Machine Unit`}
                  isOptional={false}
                  hint={processData.machineUnitHint}
                  value={processData.machineUnit}
                  onChange={(newValue) => {
                    setProcessData((d) => ({
                      ...d,
                      machineUnit: newValue?.value ?? "Total Minutes"
                    }));
                  }}
                  isConfigured={rulesByField.has(key("machineUnit"))}
                  onConfigure={
                    configurable && !temporaryItems[item.id]
                      ? () => {
                          onConfigure({
                            label: t`Machine Unit`,
                            field: key("machineUnit"),
                            code: rulesByField.get(key("machineUnit"))?.code,
                            defaultValue: processData.machineUnit,
                            returnType: {
                              type: "enum",
                              listOptions: standardFactorType
                            }
                          });
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          )}

          {processData.operationType === "Process" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack
                className="w-full justify-between cursor-pointer"
                onClick={procedureDisclosure.onToggle}
              >
                <HStack>
                  <LuListChecks />
                  <Label>Procedure</Label>
                </HStack>
                <HStack>
                  {processData.procedureId && (
                    <Badge variant="secondary">
                      <LuListChecks className="h-3 w-3 mr-1" />
                      Procedure
                    </Badge>
                  )}
                  <IconButton
                    icon={<LuChevronRight />}
                    aria-label={
                      procedureDisclosure.isOpen
                        ? "Collapse Procedure"
                        : "Expand Procedure"
                    }
                    variant="ghost"
                    size="md"
                    onClick={(e) => {
                      e.stopPropagation();
                      procedureDisclosure.onToggle();
                    }}
                    className={`transition-transform ${
                      procedureDisclosure.isOpen ? "rotate-90" : ""
                    }`}
                  />
                </HStack>
              </HStack>
              <div
                className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-1 pb-4 ${
                  procedureDisclosure.isOpen ? "" : "hidden"
                }`}
              >
                <Procedure
                  name="procedureId"
                  label={t`Procedure`}
                  processId={processData.processId}
                  value={processData.procedureId}
                  isConfigured={rulesByField.has(key("procedureId"))}
                  onConfigure={
                    configurable && !temporaryItems[item.id]
                      ? () => {
                          onConfigure({
                            label: t`Procedure`,
                            field: key("procedureId"),
                            code: rulesByField.get(key("procedureId"))?.code,
                            defaultValue: processData.procedureId,
                            returnType: {
                              type: "text",
                              helperText:
                                "the unique identifier for the procedure. you can get this from the URL when editing a procedure"
                            }
                          });
                        }
                      : undefined
                  }
                  onChange={(value) => {
                    setProcessData((d) => ({
                      ...d,
                      procedureId: value?.value as string
                    }));
                  }}
                />
              </div>
            </div>
          )}

          {processData.operationType === "Assembly" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack
                className="w-full justify-between cursor-pointer"
                onClick={assemblyDisclosure.onToggle}
              >
                <HStack>
                  <OperationTypeIcon type="Assembly" />
                  <Label>Assembly Instruction</Label>
                </HStack>
                <HStack>
                  {processData.assemblyInstructionId && (
                    <Badge variant="secondary">
                      <OperationTypeIcon
                        type="Assembly"
                        className="h-3 w-3 mr-1"
                      />
                      Assembly Instruction
                    </Badge>
                  )}
                  <IconButton
                    icon={<LuChevronRight />}
                    aria-label={
                      assemblyDisclosure.isOpen
                        ? "Collapse Assembly Instruction"
                        : "Expand Assembly Instruction"
                    }
                    variant="ghost"
                    size="md"
                    onClick={(e) => {
                      e.stopPropagation();
                      assemblyDisclosure.onToggle();
                    }}
                    className={`transition-transform ${
                      assemblyDisclosure.isOpen ? "rotate-90" : ""
                    }`}
                  />
                </HStack>
              </HStack>
              <div
                className={`grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-1 pb-4 ${
                  assemblyDisclosure.isOpen ? "" : "hidden"
                }`}
              >
                <AssemblyInstruction
                  name="assemblyInstructionId"
                  label={t`Assembly Instruction`}
                  itemId={itemId}
                  value={processData.assemblyInstructionId}
                  onChange={(value) => {
                    setProcessData((d) => ({
                      ...d,
                      assemblyInstructionId: value?.value as string
                    }));
                  }}
                />
              </div>
            </div>
          )}

          {processData.operationType === "Inspection" && (
            <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4">
              <HStack className="w-full justify-between">
                <HStack>
                  <OperationTypeIcon type="Inspection" />
                  <Label>Inspection Plan</Label>
                </HStack>
                {processData.inspectionDocumentId && (
                  <Badge variant="secondary">
                    <OperationTypeIcon
                      type="Inspection"
                      className="h-3 w-3 mr-1"
                    />
                    Inspection Plan
                  </Badge>
                )}
              </HStack>
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-1 pb-4">
                <InspectionDocument
                  name="inspectionDocumentId"
                  label={t`Inspection Plan`}
                  isOptional={false}
                  itemId={itemId}
                  value={processData.inspectionDocumentId}
                  onChange={(value) => {
                    setProcessData((d) => ({
                      ...d,
                      inspectionDocumentId: value?.value as string
                    }));
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
      <motion.div
        className="flex w-full items-center justify-end p-2"
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{
          type: "spring",
          bounce: 0,
          duration: 0.55
        }}
      >
        <motion.div layout className="ml-auto mr-1 pt-2">
          <Submit
            isDisabled={isReadOnly || methodOperationFetcher.state !== "idle"}
            isLoading={methodOperationFetcher.state === "submitting"}
          >
            Save
          </Submit>
        </motion.div>
      </motion.div>
    </ValidatedForm>
  );
}

function AttributesForm({
  operationId,
  configurable,
  isDisabled,
  steps,
  tools,
  materials,
  temporaryItems,
  rulesByField,
  onConfigure,
  itemMentions
}: {
  operationId: string;
  configurable: boolean;
  isDisabled: boolean;
  steps: OperationStep[];
  tools: OperationTool[];
  materials: MethodMaterialType[];
  temporaryItems: TemporaryItems;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
  itemMentions: { id: string; label: string }[];
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof newMethodOperationParameterAction>();
  const sortOrderFetcher = useFetcher<{ success: boolean }>();
  const [type, setType] = useState<OperationStep["type"]>("Task");
  const [description, setDescription] = useState<JSONContent>({});
  const [numericControls, setNumericControls] = useState<string[]>([]);

  // Initialize sort order state based on existing steps
  const [sortOrder, setSortOrder] = useState<string[]>(() =>
    [...steps]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((step) => step.id || "")
  );

  // Update sort order when steps change
  useEffect(() => {
    if (steps && steps.length > 0) {
      const sorted = [...steps]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((step) => step.id || "");
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
        action: path.to.methodOperationStepOrder(operationId)
      });
    },
    1000,
    true
  );
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

  const { carbon } = useCarbon();
  const user = useUser();
  const companyId = user.company.id;
  const revalidator = useRevalidator();

  // Slides chosen while creating a step are buffered here (the step has no id yet);
  // they're attached to the new step right after it's created. See the effect below.
  // A buffered slide is image XOR model (imagePath / modelUploadId).
  const [draftSlides, setDraftSlides] = useState<
    {
      id: string;
      imagePath: string | null;
      modelUploadId: string | null;
      caption: string;
      size: SlideSize;
      annotations: SlideAnnotation[];
    }[]
  >([]);
  const [draftUploading, setDraftUploading] = useState(false);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const draftModelInputRef = useRef<HTMLInputElement>(null);

  // Parts (this operation's BOM materials) the operator can assign to a step. Parts picked
  // while CREATING a step are buffered here and attached right after the step is created.
  const operationParts = useMemo(
    () =>
      (materials ?? [])
        .filter((m) => m.methodOperationId === operationId)
        .map((m) => ({
          id: m.id,
          name: m.description || m.itemId,
          quantity: m.quantity ?? 1
        })),
    [materials, operationId]
  );
  const [draftParts, setDraftParts] = useState<string[]>([]);

  // Tools (this operation's tools) the operator can assign to a step — the tool twin of
  // operationParts/draftParts. Tools picked while CREATING a step are buffered here and
  // attached right after the step is created (see the effect below).
  const allTools = useTools();
  const operationTools = useMemo(
    () =>
      (tools ?? []).map((tl) => {
        const tool = allTools.find((x) => x.id === tl.toolId);
        return {
          id: tl.id ?? "",
          name: tool?.readableIdWithRevision ?? tl.toolId ?? "",
          secondary: tool?.name ?? undefined,
          quantity: tl.quantity ?? 1
        };
      }),
    [tools, allTools]
  );
  const [draftTools, setDraftTools] = useState<string[]>([]);

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error(t`Failed to upload image`);
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  // Upload a chosen image to storage immediately and buffer it as a draft slide.
  const onAddDraftSlide = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon) return;
    setDraftUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${companyId}/parts/${nanoid()}.${ext}`;
      const result = await carbon.storage
        .from("private")
        .upload(fileName, file);
      if (result.error || !result.data) {
        toast.error(t`Failed to upload image`);
        return;
      }
      setDraftSlides((prev) => [
        ...prev,
        {
          id: nanoid(),
          imagePath: result.data.path,
          modelUploadId: null,
          caption: "",
          size: "medium",
          annotations: []
        }
      ]);
    } finally {
      setDraftUploading(false);
    }
  };

  // Upload a chosen 3D model, register it as a modelUpload (which also kicks the
  // assembler's STEP → GLB conversion), and buffer it as a draft model slide.
  const onAddDraftModel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon) return;
    setDraftUploading(true);
    try {
      const modelUploadId = await uploadStepSlideModel(carbon, companyId, file);
      if (!modelUploadId) {
        toast.error(t`Failed to upload model`);
        return;
      }
      setDraftSlides((prev) => [
        ...prev,
        {
          id: nanoid(),
          imagePath: null,
          modelUploadId,
          caption: "",
          size: "medium",
          annotations: []
        }
      ]);
    } finally {
      setDraftUploading(false);
    }
  };

  // When the new step is created, attach any buffered slides to it, then revalidate so
  // they show on the step and reset the buffer for the next step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the created step id
  useEffect(() => {
    const newStepId = (fetcher.data as { id?: string | null } | undefined)?.id;
    if (!newStepId || draftSlides.length === 0 || !carbon) return;
    let cancelled = false;
    (async () => {
      const slideRows = draftSlides.map((slide, index) => ({
        stepId: newStepId,
        imagePath: slide.imagePath,
        modelUploadId: slide.modelUploadId,
        caption: slide.caption || null,
        sortOrder: index + 1,
        size: slide.size,
        annotations: slide.annotations,
        companyId,
        createdBy: user.id
      }));
      const { error } = await carbon
        .from("methodOperationStepSlide")
        .insert(slideRows);
      if (cancelled) return;
      if (error) {
        toast.error(t`Failed to save slides`);
        return;
      }
      setDraftSlides([]);
      revalidator.revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher.data]);

  // When the new step is created, attach any buffered parts, then revalidate + reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the created step id
  useEffect(() => {
    const newStepId = (fetcher.data as { id?: string | null } | undefined)?.id;
    if (!newStepId || draftParts.length === 0 || !carbon) return;
    let cancelled = false;
    (async () => {
      const { error } = await carbon.from("methodMaterialStep").insert(
        draftParts.map((methodMaterialId) => ({
          methodMaterialId,
          methodOperationStepId: newStepId
        }))
      );
      if (cancelled) return;
      if (error) {
        toast.error(t`Failed to save parts`);
        return;
      }
      setDraftParts([]);
      revalidator.revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher.data]);

  // When the new step is created, attach any buffered tools, then revalidate + reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the created step id
  useEffect(() => {
    const newStepId = (fetcher.data as { id?: string | null } | undefined)?.id;
    if (!newStepId || draftTools.length === 0 || !carbon) return;
    let cancelled = false;
    (async () => {
      const { error } = await carbon.from("methodOperationToolStep").insert(
        draftTools.map((methodOperationToolId) => ({
          methodOperationToolId,
          methodOperationStepId: newStepId
        }))
      );
      if (cancelled) return;
      if (error) {
        toast.error(t`Failed to save tools`);
        return;
      }
      setDraftTools([]);
      revalidator.revalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher.data]);

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>
          <Trans>Cannot add steps to unsaved operation</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>Please save the operation before adding steps.</Trans>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Loading
      className="flex flex-col gap-6"
      isLoading={fetcher.state !== "idle"}
      // this is a hack to re-render the editor component when the form is submitted with the default values
    >
      {!isDisabled && (
        <div className="p-6 border bg-card rounded-lg mb-6">
          <ValidatedForm
            action={path.to.newMethodOperationStep}
            method="post"
            validator={operationStepValidator}
            fetcher={fetcher}
            resetAfterSubmit
            defaultValues={{
              id: undefined,
              name: "",
              description: {},
              type: "Task",
              unitOfMeasureCode: "",
              minValue: 0,
              maxValue: 0,
              listValues: [],
              sortOrder:
                steps.reduce((acc, a) => Math.max(acc, a.sortOrder ?? 0), 0) +
                1,
              operationId
            }}
            onSubmit={() => {
              setType("Task");
              setDescription({});
            }}
            className="w-full"
          >
            <Hidden name="operationId" />
            <Hidden name="sortOrder" />
            <Hidden name="description" value={JSON.stringify(description)} />
            <VStack spacing={4}>
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <SelectControlled
                  name="type"
                  label={t`Type`}
                  options={typeOptions}
                  value={type}
                  onChange={(option) => {
                    if (option) {
                      setType(option.value as OperationStep["type"]);
                    }
                  }}
                />
                <Input name="name" label={t`Name`} />
              </div>

              <VStack spacing={2} className="w-full col-span-2">
                <Label>Description</Label>
                <Editor
                  initialValue={description}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setDescription(value);
                  }}
                  mentions={[{ char: "@", items: itemMentions }]}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
                />
              </VStack>

              {type === "Measurement" && (
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  <UnitOfMeasure
                    name="unitOfMeasureCode"
                    label={t`Unit of Measure`}
                  />

                  <ToggleGroup
                    type="multiple"
                    value={numericControls}
                    onValueChange={setNumericControls}
                    className="justify-start items-start mt-6"
                  >
                    <ToggleGroupItem size="sm" value="min">
                      <LuMinimize2 className="mr-2" />
                      Minimum
                    </ToggleGroupItem>
                    <ToggleGroupItem size="sm" value="max">
                      <LuMaximize2 className="mr-2" />
                      Maximum
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
                </div>
              )}
              {type === "List" && (
                <ArrayInput name="listValues" label={t`List Options`} />
              )}

              <SlidesEditor
                slides={draftSlides.map((slide) => ({
                  key: slide.id,
                  imagePath: slide.imagePath,
                  modelUploadId: slide.modelUploadId,
                  caption: slide.caption,
                  size: slide.size,
                  annotations: slide.annotations
                }))}
                isDisabled={isDisabled}
                busy={draftUploading}
                fileInputRef={draftFileInputRef}
                onFileChange={onAddDraftSlide}
                modelInputRef={draftModelInputRef}
                onModelFileChange={onAddDraftModel}
                onRemove={(index) =>
                  setDraftSlides((prev) => prev.filter((_, i) => i !== index))
                }
                onCaptionBlur={(index, caption) =>
                  setDraftSlides((prev) =>
                    prev.map((slide, i) =>
                      i === index ? { ...slide, caption } : slide
                    )
                  )
                }
                onAnnotationsChange={(index, annotations) =>
                  setDraftSlides((prev) =>
                    prev.map((slide, i) =>
                      i === index ? { ...slide, annotations } : slide
                    )
                  )
                }
              />

              <StepLinkEditor
                label={t`Parts`}
                addLabel={t`Add parts`}
                emptyLabel={t`No parts`}
                searchPlaceholder={t`Search parts...`}
                removeLabel={t`Remove part`}
                items={operationParts}
                linkedIds={draftParts}
                isDisabled={isDisabled}
                onAdd={(partId) =>
                  setDraftParts((prev) =>
                    prev.includes(partId) ? prev : [...prev, partId]
                  )
                }
                onRemove={(partId) =>
                  setDraftParts((prev) => prev.filter((id) => id !== partId))
                }
              />

              <StepLinkEditor
                label={t`Tools`}
                addLabel={t`Add tools`}
                emptyLabel={t`No tools`}
                searchPlaceholder={t`Search tools...`}
                removeLabel={t`Remove tool`}
                icon={<LuHammer />}
                items={operationTools}
                linkedIds={draftTools}
                isDisabled={isDisabled}
                onAdd={(toolId) =>
                  setDraftTools((prev) =>
                    prev.includes(toolId) ? prev : [...prev, toolId]
                  )
                }
                onRemove={(toolId) =>
                  setDraftTools((prev) => prev.filter((id) => id !== toolId))
                }
              />

              <Submit
                leftIcon={<LuCirclePlus />}
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save Step
              </Submit>
            </VStack>
          </ValidatedForm>
        </div>
      )}

      {steps.length > 0 && (
        <div className="border rounded-lg">
          <Reorder.Group
            axis="y"
            values={sortOrder}
            onReorder={onReorder}
            className="w-full"
          >
            {sortOrder.map((stepId) => {
              const step = steps.find((s) => s.id === stepId);
              if (!step) return null;
              const index = sortOrder.indexOf(stepId);
              return (
                <DraggableStepItem
                  key={stepId}
                  stepId={stepId}
                  isDisabled={isDisabled}
                >
                  {(dragControls) => (
                    <AttributesListItem
                      attribute={step}
                      operationId={operationId}
                      typeOptions={typeOptions}
                      materials={materials}
                      tools={tools}
                      isDisabled={isDisabled}
                      dragControls={dragControls}
                      className={cn(
                        index === 0 && "rounded-t-lg",
                        index === sortOrder.length - 1 &&
                          "rounded-b-lg border-none"
                      )}
                      configurable={configurable}
                      rulesByField={rulesByField}
                      onConfigure={onConfigure}
                      itemMentions={itemMentions}
                    />
                  )}
                </DraggableStepItem>
              );
            })}
          </Reorder.Group>
        </div>
      )}
      {steps.length === 0 && isDisabled && (
        <div className="flex flex-1 py-24 justify-between items-center w-full">
          <Empty />
        </div>
      )}
    </Loading>
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

function AttributesListItem({
  attribute,
  operationId,
  typeOptions,
  materials,
  tools,
  className,
  configurable,
  rulesByField,
  onConfigure,
  isDisabled = false,
  dragControls,
  itemMentions
}: {
  attribute: OperationStep;
  operationId: string;
  typeOptions: { label: JSX.Element; value: string }[];
  materials: MethodMaterialType[];
  tools: OperationTool[];
  className?: string;
  configurable: boolean;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
  isDisabled?: boolean;
  dragControls?: DragControls;
  itemMentions: { id: string; label: string }[];
}) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const {
    name,
    unitOfMeasureCode,
    minValue,
    maxValue,
    id,
    updatedBy,
    updatedAt,
    createdBy,
    createdAt
  } = attribute;

  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editMethodOperationStepAction>();
  const duplicateFetcher = useFetcher();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
  }, [fetcher.state]);

  const [type, setType] = useState<OperationStep["type"]>(attribute.type);
  const [numericControls, setNumericControls] = useState<string[]>(() => {
    const controls = [];
    if (type === "Measurement") {
      if (minValue !== null) {
        controls.push("min");
      }
      if (maxValue !== null) {
        controls.push("max");
      }
    }
    return controls;
  });

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  const unitOfMeasures = useUnitOfMeasure();
  const [description, setDescription] = useState<JSONContent>(
    attribute.description ?? {}
  );

  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/parts/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error(t`Failed to upload image`);
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  if (!id) return null;

  const isConfigured =
    configurable &&
    attribute.type === "Measurement" &&
    (rulesByField.has(getFieldKey(`attribute:${id}:minValue`, operationId)) ||
      rulesByField.has(getFieldKey(`attribute:${id}:maxValue`, operationId)));

  return (
    <div className={cn("border-b p-6 bg-card", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.methodOperationStep(id)}
          method="post"
          validator={operationStepValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            ...attribute,
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <Hidden name="description" value={JSON.stringify(description)} />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <SelectControlled
                name="type"
                label={t`Type`}
                options={typeOptions}
                onChange={(option) => {
                  if (option) {
                    setType(option.value as OperationStep["type"]);
                  }
                }}
              />
              <Input name="name" label={t`Name`} />
            </div>

            <VStack spacing={2} className="w-full col-span-2">
              <Label>Description</Label>
              <Editor
                initialValue={description}
                onUpload={onUploadImage}
                onChange={(value) => {
                  setDescription(value);
                }}
                mentions={[{ char: "@", items: itemMentions }]}
                className="[&_.is-empty]:text-muted-foreground min-h-[120px] p-4 rounded-lg border w-full"
              />
            </VStack>

            {type === "Measurement" && (
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label={t`Unit of Measure`}
                />

                <ToggleGroup
                  type="multiple"
                  value={numericControls}
                  onValueChange={setNumericControls}
                  className="justify-start items-start mt-6"
                >
                  <ToggleGroupItem size="sm" value="min">
                    <LuMinimize2 className="mr-2" />
                    Minimum
                  </ToggleGroupItem>
                  <ToggleGroupItem size="sm" value="max">
                    <LuMaximize2 className="mr-2" />
                    Maximum
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
                    isConfigured={rulesByField.has(
                      getFieldKey(`attribute:${id}:minValue`, operationId)
                    )}
                    onConfigure={
                      configurable && typeof onConfigure === "function"
                        ? () => {
                            onConfigure({
                              label: t`Minimum`,
                              field: getFieldKey(
                                `attribute:${id}:minValue`,
                                operationId
                              ),
                              code: rulesByField.get(
                                getFieldKey(
                                  `attribute:${id}:minValue`,
                                  operationId
                                )
                              )?.code,
                              defaultValue: minValue ?? 0,
                              returnType: {
                                type: "numeric"
                              }
                            });
                          }
                        : undefined
                    }
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
                    isConfigured={rulesByField.has(
                      getFieldKey(`attribute:${id}:maxValue`, operationId)
                    )}
                    onConfigure={
                      configurable && typeof onConfigure === "function"
                        ? () => {
                            onConfigure({
                              label: t`Maximum`,
                              field: getFieldKey(
                                `attribute:${id}:maxValue`,
                                operationId
                              ),
                              code: rulesByField.get(
                                getFieldKey(
                                  `attribute:${id}:maxValue`,
                                  operationId
                                )
                              )?.code,
                              defaultValue: maxValue ?? 0,
                              returnType: {
                                type: "numeric"
                              }
                            });
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            )}
            {type === "List" && (
              <ArrayInput name="listValues" label={t`List Options`} />
            )}
            <StepSlides step={attribute} isDisabled={isDisabled} />
            <StepParts
              step={attribute}
              operationId={operationId}
              materials={materials}
              isDisabled={isDisabled}
            />
            <StepTools step={attribute} tools={tools} isDisabled={isDisabled} />
            <HStack className="w-full justify-end" spacing={2}>
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-1 justify-between items-center w-full">
          <HStack spacing={4} className="w-1/2">
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
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <ProcedureStepTypeIcon type={type} />
              </div>
              <VStack spacing={0}>
                <HStack>
                  <p className="text-foreground text-sm font-medium">
                    {attribute.name}
                  </p>
                  {attribute.description &&
                    Object.keys(attribute.description).length > 0 && (
                      <Tooltip>
                        <TooltipTrigger>
                          <LuInfo className="text-muted-foreground size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p
                            className="prose prose-sm dark:prose-invert text-foreground text-sm"
                            dangerouslySetInnerHTML={{
                              __html: generateHTML(attribute.description)
                            }}
                          />
                        </TooltipContent>
                      </Tooltip>
                    )}
                </HStack>
                {attribute.type === "Measurement" && (
                  <span className="text-xs text-muted-foreground">
                    {attribute.minValue !== null && attribute.maxValue !== null
                      ? `Must be between ${attribute.minValue} and ${
                          attribute.maxValue
                        } ${
                          unitOfMeasures.find(
                            (u) => u.value === unitOfMeasureCode
                          )?.label
                        }`
                      : attribute.minValue !== null
                        ? `Must be > ${attribute.minValue} ${
                            unitOfMeasures.find(
                              (u) => u.value === unitOfMeasureCode
                            )?.label
                          }`
                        : attribute.maxValue !== null
                          ? `Must be < ${attribute.maxValue} ${
                              unitOfMeasures.find(
                                (u) => u.value === unitOfMeasureCode
                              )?.label
                            }`
                          : null}
                  </span>
                )}
              </VStack>
              {isConfigured && (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-col items-center justify-center gap-1 text-emerald-500">
                      <LuSquareFunction
                        aria-label={t`Configured`}
                        className="size-4 "
                      />
                      <span className="text-xxs font-mono uppercase">
                        Configured
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-foreground text-sm">
                      This attribute is configured
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {attribute.type === "List" &&
                Array.isArray(attribute.listValues) && (
                  <Tooltip>
                    <TooltipTrigger>
                      <LuList className="size-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {attribute.listValues.map((value) => (
                        <p key={value} className="text-foreground text-sm">
                          {value}
                        </p>
                      ))}
                    </TooltipContent>
                  </Tooltip>
                )}
            </HStack>
          </HStack>
          <div className="flex items-center justify-end gap-2">
            <HStack spacing={2}>
              {/* Light revision surface: relative time inline, full created + updated
                  history (who / when) on hover. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground">
                    {isUpdated ? "Updated" : "Created"}{" "}
                    {formatRelativeTime(date)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="flex flex-col gap-0.5 text-xs">
                    <span>Created {formatRelativeTime(createdAt)}</span>
                    {updatedAt ? (
                      <span>Updated {formatRelativeTime(updatedAt)}</span>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
              <EmployeeAvatar employeeId={person} withName={false} />
            </HStack>
            {!isDisabled && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Open menu`}
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={disclosure.onOpen}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      duplicateFetcher.submit(null, {
                        method: "post",
                        action: path.to.duplicateMethodOperationStep(id)
                      })
                    }
                  >
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    onClick={deleteModalDisclosure.onOpen}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      {deleteModalDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteMethodOperationStep(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={name}
          text={`Are you sure you want to delete the ${name} attribute from this operation? This cannot be undone.`}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

// Parts assigned to an EXISTING step — the step-side of the part↔step link. Lists this
// operation's BOM parts and toggles each link immediately via the material route. Replaces
// the old BOM "Steps" dropdown (assignment now lives on the step).
function StepParts({
  step,
  operationId,
  materials,
  isDisabled
}: {
  step: OperationStep;
  operationId: string;
  materials: MethodMaterialType[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();

  const operationParts = (materials ?? [])
    .filter((m) => m.methodOperationId === operationId)
    .map((m) => ({
      id: m.id,
      name: m.description || m.itemId,
      quantity: m.quantity ?? 1
    }));

  const linkedPartIds = (materials ?? [])
    .filter((m) =>
      (m.methodMaterialStep ?? []).some(
        (s) => s.methodOperationStepId === step.id
      )
    )
    .map((m) => m.id);

  const toggle = (partId: string, linked: boolean) => {
    if (!step.id) return;
    const fd = new FormData();
    fd.append("materialId", partId);
    fd.append("stepId", step.id);
    fd.append("linked", String(linked));
    fetcher.submit(fd, {
      method: "post",
      action: path.to.methodOperationStepMaterial
    });
  };

  return (
    <StepLinkEditor
      label={t`Parts`}
      addLabel={t`Add parts`}
      emptyLabel={t`No parts`}
      searchPlaceholder={t`Search parts...`}
      removeLabel={t`Remove part`}
      items={operationParts}
      linkedIds={linkedPartIds}
      isDisabled={isDisabled}
      busy={fetcher.state !== "idle"}
      onAdd={(id) => toggle(id, true)}
      onRemove={(id) => toggle(id, false)}
    />
  );
}

// Tools assigned to an EXISTING step — the step-side of the tool↔step link. Lists this
// operation's tools and toggles each link immediately via the tool route (assignment now
// lives on the step, not the tool modal). Twin of StepParts.
function StepTools({
  step,
  tools,
  isDisabled
}: {
  step: OperationStep;
  tools: OperationTool[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const allTools = useTools();

  const operationTools = (tools ?? []).map((tl) => {
    const tool = allTools.find((x) => x.id === tl.toolId);
    return {
      id: tl.id ?? "",
      name: tool?.readableIdWithRevision ?? tl.toolId ?? "",
      secondary: tool?.name ?? undefined,
      quantity: tl.quantity ?? 1
    };
  });

  const linkedToolIds = (tools ?? [])
    .filter((tl) =>
      (
        tl.methodOperationStepIds ??
        (
          (
            tl as {
              methodOperationToolStep?: { methodOperationStepId: string }[];
            }
          ).methodOperationToolStep ?? []
        ).map((s) => s.methodOperationStepId)
      ).some((stepId) => stepId === step.id)
    )
    .map((tl) => tl.id ?? "");

  const toggle = (toolId: string, linked: boolean) => {
    if (!step.id) return;
    const fd = new FormData();
    fd.append("toolId", toolId);
    fd.append("stepId", step.id);
    fd.append("linked", String(linked));
    fetcher.submit(fd, {
      method: "post",
      action: path.to.methodOperationStepTool
    });
  };

  return (
    <StepLinkEditor
      label={t`Tools`}
      addLabel={t`Add tools`}
      emptyLabel={t`No tools`}
      searchPlaceholder={t`Search tools...`}
      removeLabel={t`Remove tool`}
      icon={<LuHammer />}
      items={operationTools}
      linkedIds={linkedToolIds}
      isDisabled={isDisabled}
      busy={fetcher.state !== "idle"}
      onAdd={(id) => toggle(id, true)}
      onRemove={(id) => toggle(id, false)}
    />
  );
}

// Reference images ("slides") for an EXISTING step — upload (one image/slide to the
// private bucket), caption, delete, persisted immediately via the slide routes. Copied
// to job/quote by get-method. See .ai/specs/2026-07-14-mes-execution-views.md §4.
function StepSlides({
  step,
  isDisabled
}: {
  step: OperationStep;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const captionFetcher = useFetcher();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const slides = ((step.methodOperationStepSlide ?? []) as OperationStepSlide[])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const nextSortOrder = () =>
    slides.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0) + 1;

  const onAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon || !step.id) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${companyId}/parts/${nanoid()}.${ext}`;
      const result = await carbon.storage
        .from("private")
        .upload(fileName, file);
      if (result.error || !result.data) {
        toast.error(t`Failed to upload image`);
        return;
      }
      const fd = new FormData();
      fd.append("stepId", step.id);
      fd.append("imagePath", result.data.path);
      fd.append("sortOrder", String(nextSortOrder()));
      fetcher.submit(fd, {
        method: "post",
        action: path.to.newMethodOperationStepSlide
      });
    } finally {
      setUploading(false);
    }
  };

  // Upload a 3D model and attach it to the step as a model slide. The model-upload
  // API also starts the assembler's STEP → GLB conversion.
  const onAddModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon || !step.id) return;
    setUploading(true);
    try {
      const modelUploadId = await uploadStepSlideModel(carbon, companyId, file);
      if (!modelUploadId) {
        toast.error(t`Failed to upload model`);
        return;
      }
      const fd = new FormData();
      fd.append("stepId", step.id);
      fd.append("modelUploadId", modelUploadId);
      fd.append("sortOrder", String(nextSortOrder()));
      fetcher.submit(fd, {
        method: "post",
        action: path.to.newMethodOperationStepSlide
      });
    } finally {
      setUploading(false);
    }
  };

  // Update one slide: always carries the required fields (id → the route updates rather
  // than inserts; stepId + the slide's content field satisfy the validator) plus whatever
  // changed. Fields not sent are preserved, so a caption edit never wipes size/annotations
  // and vice-versa.
  function saveSlide(
    slide: OperationStepSlide,
    fields: Record<string, string>
  ) {
    const fd = new FormData();
    fd.append("id", slide.id);
    fd.append("stepId", slide.stepId);
    if (slide.imagePath) fd.append("imagePath", slide.imagePath);
    if (slide.modelUploadId) fd.append("modelUploadId", slide.modelUploadId);
    fd.append("sortOrder", String(slide.sortOrder ?? 1));
    for (const [key, value] of Object.entries(fields)) fd.append(key, value);
    captionFetcher.submit(fd, {
      method: "post",
      action: path.to.newMethodOperationStepSlide
    });
  }

  return (
    <SlidesEditor
      slides={slides.map((s) => ({
        key: s.id,
        imagePath: s.imagePath,
        modelUploadId: s.modelUploadId,
        caption: s.caption,
        size: s.size,
        annotations: s.annotations
      }))}
      isDisabled={isDisabled}
      busy={uploading || fetcher.state !== "idle"}
      fileInputRef={fileInputRef}
      onFileChange={onAddFile}
      modelInputRef={modelInputRef}
      onModelFileChange={onAddModelFile}
      onRemove={(index) => {
        const slide = slides[index];
        if (!slide) return;
        fetcher.submit(null, {
          method: "post",
          action: path.to.deleteMethodOperationStepSlide(slide.id)
        });
      }}
      onCaptionBlur={(index, caption) => {
        const slide = slides[index];
        if (slide && (slide.caption ?? "") !== caption)
          saveSlide(slide, { caption });
      }}
      onAnnotationsChange={(index, annotations) => {
        const slide = slides[index];
        if (slide)
          saveSlide(slide, { annotations: JSON.stringify(annotations) });
      }}
    />
  );
}

function ParametersForm({
  operationId,
  configurable,
  isDisabled,
  parameters,
  temporaryItems,
  rulesByField,
  onConfigure
}: {
  operationId: string;
  configurable: boolean;
  isDisabled: boolean;
  parameters: OperationParameter[];
  temporaryItems: TemporaryItems;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof newMethodOperationParameterAction>();

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>
          <Trans>Cannot add parameters to unsaved operation</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>Please save the operation before adding parameters.</Trans>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!isDisabled && (
        <div className="p-6 border rounded-lg bg-card">
          <ValidatedForm
            action={path.to.newMethodOperationParameter}
            method="post"
            validator={operationParameterValidator}
            fetcher={fetcher}
            resetAfterSubmit
            defaultValues={{
              id: undefined,
              key: "",
              value: "",
              operationId
            }}
            className="w-full"
          >
            <Hidden name="operationId" />
            <VStack spacing={4}>
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <Input
                  name="key"
                  label={t`Key`}
                  autoFocus={parameters.length === 0}
                />
                <Input name="value" label={t`Value`} />
              </div>
              <Submit
                leftIcon={<LuCirclePlus />}
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Add Parameter
              </Submit>
            </VStack>
          </ValidatedForm>
        </div>
      )}

      {parameters.length > 0 && (
        <div className="border bg-card rounded-lg">
          {[...parameters]
            .sort((a, b) =>
              String(a.id ?? "").localeCompare(String(b.id ?? ""))
            )
            .map((p, index) => (
              <ParametersListItem
                key={p.id}
                parameter={p}
                operationId={operationId}
                className={index === parameters.length - 1 ? "border-none" : ""}
                configurable={configurable}
                rulesByField={rulesByField}
                onConfigure={onConfigure}
                isDisabled={isDisabled}
              />
            ))}
        </div>
      )}
      {parameters.length === 0 && isDisabled && (
        <div className="flex flex-1 py-24 justify-between items-center w-full">
          <Empty />
        </div>
      )}
    </div>
  );
}

function ParametersListItem({
  parameter: { key, value, id, updatedBy, updatedAt, createdBy, createdAt },
  operationId,
  className,
  configurable,
  rulesByField,
  onConfigure,
  isDisabled = false
}: {
  parameter: OperationParameter;
  operationId: string;
  className?: string;
  configurable: boolean;
  rulesByField: Map<string, ConfigurationRule>;
  onConfigure?: (c: Configuration) => void;
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editMethodOperationParameterAction>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
  }, [fetcher.state]);

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  if (!id) return null;

  const isConfigured = rulesByField.has(
    getFieldKey(`parameter:${id}:value`, operationId)
  );

  return (
    <div className={cn("border-b p-6", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.methodOperationParameter(id)}
          method="post"
          validator={operationParameterValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: id,
            key: key ?? "",
            value: value ?? "",
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Input name="key" label={t`Key`} />
              <Input
                name="value"
                label={t`Value`}
                isConfigured={isConfigured}
                onConfigure={
                  configurable && typeof onConfigure === "function"
                    ? () => {
                        onConfigure({
                          label: key,
                          field: getFieldKey(
                            `parameter:${id}:value`,
                            operationId
                          ),
                          code: rulesByField.get(
                            getFieldKey(`parameter:${id}:value`, operationId)
                          )?.code,
                          defaultValue: value,
                          returnType: {
                            type: "text"
                          }
                        });
                      }
                    : undefined
                }
              />
            </div>
            <HStack className="w-full justify-end" spacing={2}>
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-1 justify-between items-center w-full">
          <HStack spacing={4} className="w-1/2">
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <LuActivity
                  className={cn("size-4", isConfigured && "text-emerald-500")}
                />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{key}</span>
              </VStack>
              {isConfigured ? (
                <Tooltip>
                  <TooltipTrigger>
                    <div className="flex flex-col items-center justify-center gap-1 text-emerald-500">
                      <LuSquareFunction
                        aria-label={t`Configured`}
                        className="size-4 "
                      />
                      <span className="text-xxs font-mono uppercase">
                        Configured
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-foreground text-sm">
                      This value is configured
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-base text-muted-foreground text-right">
                  {value}
                </span>
              )}
            </HStack>
          </HStack>
          <div className="flex items-center justify-end gap-2">
            <HStack spacing={2}>
              <span className="text-xs text-muted-foreground">
                {isUpdated ? "Updated" : "Created"} {formatRelativeTime(date)}
              </span>
              <EmployeeAvatar employeeId={person} withName={false} />
            </HStack>
            {!isDisabled && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Open menu`}
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={disclosure.onOpen}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    onClick={deleteModalDisclosure.onOpen}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      {deleteModalDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteMethodOperationParameter(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={key}
          text={`Are you sure you want to delete the ${key} parameter from this operation? This cannot be undone.`}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

// Read-only MES assembly preview for an operation (Phase 3). Mirrors the MES per-step
// layout: a step pager, the step's first reference slide, the step text, and the tools
// scoped to that step (unscoped tools show on every step). No live job, no mutations.
function OperationPreview({
  steps,
  tools
}: {
  steps: OperationStep[];
  tools: OperationTool[];
}) {
  const { t } = useLingui();
  const allTools = useTools();
  const [current, setCurrent] = useState(0);

  const sorted = [...steps].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        <Trans>Add steps to preview the operator view.</Trans>
      </div>
    );
  }

  const idx = Math.min(current, sorted.length - 1);
  const step = sorted[idx];
  const slides = [...(step.methodOperationStepSlide ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  // First IMAGE slide for the preview panel — model slides render only in the MES
  // assembly view; here they'd have no picture to show.
  const firstImagePath = slides.find((s) => s.imagePath)?.imagePath;
  const image = firstImagePath ? getPrivateUrl(firstImagePath) : null;

  // Tools scoped to this step + operation-level (no links) tools shown on every step
  // (tool ↔ step is many-to-many).
  const stepTools = tools.filter((tl) => {
    const ids: string[] =
      tl.methodOperationStepIds ??
      (
        (
          tl as {
            methodOperationToolStep?: { methodOperationStepId: string }[];
          }
        ).methodOperationToolStep ?? []
      ).map((s) => s.methodOperationStepId);
    return ids.length === 0 || (!!step.id && ids.includes(step.id));
  });

  const descriptionHtml =
    step.description && typeof step.description === "object"
      ? generateHTML(step.description as Parameters<typeof generateHTML>[0])
      : "";

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t`Step`} {idx + 1} / {sorted.length}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="md"
            isIcon
            aria-label={t`Previous step`}
            isDisabled={idx <= 0}
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          >
            <LuChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="md"
            isIcon
            aria-label={t`Next step`}
            isDisabled={idx >= sorted.length - 1}
            onClick={() =>
              setCurrent((c) => Math.min(sorted.length - 1, c + 1))
            }
          >
            <LuChevronRight />
          </Button>
        </div>
      </div>

      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-muted/40">
        {image ? (
          <img
            src={image}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            <Trans>No reference image</Trans>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
          {idx + 1}
        </span>
        {step.type ? <Badge variant="secondary">{step.type}</Badge> : null}
      </div>
      <p className="text-sm font-medium">{step.name ?? t`Step`}</p>
      {descriptionHtml ? (
        <div
          className="prose prose-sm max-w-none text-sm dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      ) : null}

      <div className="flex flex-col gap-1 border-t pt-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Trans>Tools</Trans>
        </span>
        {stepTools.length > 0 ? (
          stepTools.map((tl, i) => {
            const tool = allTools.find((x) => x.id === tl.toolId);
            return (
              <div key={tl.id ?? i} className="flex items-center gap-2 py-0.5">
                <LuHammer className="size-3 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-xs">
                  {tool?.readableIdWithRevision ?? tl.toolId}
                </span>
                {tl.quantity > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    ×{tl.quantity}
                  </span>
                ) : null}
              </div>
            );
          })
        ) : (
          <span className="text-xs text-muted-foreground">
            <Trans>No tools for this step</Trans>
          </span>
        )}
      </div>
    </div>
  );
}

function ToolsForm({
  operationId,
  isDisabled,
  tools,
  temporaryItems
}: {
  operationId: string;
  isDisabled: boolean;
  tools: OperationTool[];
  temporaryItems: TemporaryItems;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof newMethodOperationToolAction>();

  if (isDisabled && temporaryItems[operationId]) {
    return (
      <Alert className="max-w-[420px] mx-auto my-8">
        <LuTriangleAlert />
        <AlertTitle>
          <Trans>Cannot add tools to unsaved operation</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>Please save the operation before adding tools.</Trans>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {!isDisabled && (
        <div className="p-6 border rounded-lg bg-card">
          <ValidatedForm
            action={path.to.newMethodOperationTool}
            method="post"
            validator={operationToolValidator}
            fetcher={fetcher}
            resetAfterSubmit
            defaultValues={{
              id: undefined,
              toolId: "",
              quantity: 1,
              operationId
            }}
            className="w-full"
          >
            <Hidden name="operationId" />
            <VStack spacing={4}>
              <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <Tool
                  name="toolId"
                  label={t`Tool`}
                  autoFocus={tools.length === 0}
                />
                <Number name="quantity" label={t`Quantity`} />
              </div>

              {/* Tool↔step assignment lives on the step editor now, not here — a tool added
                  from this form starts operation-level (shown on every step in the MES). */}

              <Submit
                leftIcon={<LuCirclePlus />}
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save Tool
              </Submit>
            </VStack>
          </ValidatedForm>
        </div>
      )}

      {tools.length > 0 && (
        <div className="border rounded-lg">
          {[...tools]
            .sort((a, b) =>
              String(a.id ?? "").localeCompare(String(b.id ?? ""))
            )
            .map((t, index) => (
              <ToolsListItem
                key={t.id}
                tool={t}
                operationId={operationId}
                className={cn(
                  index === 0 && "rounded-t-lg",
                  index === tools.length - 1 && "rounded-b-lg border-none"
                )}
                isDisabled={isDisabled}
              />
            ))}
        </div>
      )}
      {tools.length === 0 && isDisabled && (
        <div className="flex flex-1 py-24 justify-between items-center w-full">
          <Empty />
        </div>
      )}
    </div>
  );
}

function ToolsListItem({
  tool: { toolId, quantity, id, updatedBy, updatedAt, createdBy, createdAt },
  operationId,
  className,
  isDisabled = false
}: {
  tool: OperationTool;
  operationId: string;
  className?: string;
  isDisabled?: boolean;
}) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof editMethodOperationToolAction>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
  }, [fetcher.state]);

  const tools = useTools();
  const tool = tools.find((t) => t.id === toolId);
  if (!tool || !id) return null;

  const isUpdated = updatedBy !== null;
  const person = isUpdated ? updatedBy : createdBy;
  const date = updatedAt ?? createdAt;

  return (
    <div className={cn("border-b p-6 bg-card", className)}>
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.methodOperationTool(id)}
          method="post"
          validator={operationToolValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: id,
            toolId: toolId ?? "",
            quantity: quantity ?? 1,
            operationId
          }}
          className="w-full"
        >
          <Hidden name="operationId" />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <Tool name="toolId" label={t`Tool`} autoFocus />
              <Number name="quantity" label={t`Quantity`} />
            </div>

            {/* Tool↔step assignment lives on the step editor now (not here). */}

            <HStack className="w-full justify-end" spacing={2}>
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-1 justify-between items-center w-full">
          <HStack spacing={4} className="w-1/2">
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <LuHammer className="size-4" />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">
                  {tool.readableIdWithRevision}
                </span>
                <span className="text-xs text-muted-foreground">
                  {tool.name}
                </span>
              </VStack>
              <span className="text-base text-muted-foreground text-right">
                {quantity}
              </span>
            </HStack>
          </HStack>
          <div className="flex items-center justify-end gap-2">
            <HStack spacing={2}>
              <span className="text-xs text-muted-foreground">
                {isUpdated ? "Updated" : "Created"} {formatRelativeTime(date)}
              </span>
              <EmployeeAvatar employeeId={person} withName={false} />
            </HStack>
            {!isDisabled && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Open menu`}
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={disclosure.onOpen}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    onClick={deleteModalDisclosure.onOpen}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}
      {deleteModalDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteMethodOperationTool(id)}
          isOpen={deleteModalDisclosure.isOpen}
          name={tool.readableIdWithRevision}
          text={`Are you sure you want to delete ${tool.readableIdWithRevision} from this operation? This cannot be undone.`}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

function makeItems(
  operations: Operation[],
  tags: { name: string }[]
): ItemWithData[] {
  return operations.map((operation) => makeItem(operation, tags));
}

function makeItem(
  operation: Operation,
  tags: { name: string }[]
): ItemWithData {
  return {
    id: operation.id!,
    title: (
      <VStack spacing={0}>
        <h3 className="font-semibold truncate cursor-pointer">
          {operation.description}
        </h3>
        {operation.operationType === "Outside Processing" && (
          <SupplierProcessPreview
            processId={operation.processId}
            supplierProcessId={operation.operationSupplierProcessId}
          />
        )}
      </VStack>
    ),
    checked: false,
    order: operation.operationOrder,
    details: (
      <HStack spacing={1}>
        {operation.operationType === "Outside Processing" ? (
          <Badge>Outside Processing</Badge>
        ) : (
          <>
            {(operation?.setupTime ?? 0) > 0 && (
              <Badge variant="secondary">
                <TimeTypeIcon type="Setup" className="h-3 w-3 mr-1" />
                {operation.setupTime} {operation.setupUnit}
              </Badge>
            )}
            {(operation?.laborTime ?? 0) > 0 && (
              <Badge variant="secondary">
                <TimeTypeIcon type="Labor" className="h-3 w-3 mr-1" />
                {operation.laborTime} {operation.laborUnit}
              </Badge>
            )}
            {(operation?.machineTime ?? 0) > 0 && (
              <Badge variant="secondary">
                <TimeTypeIcon type="Machine" className="h-3 w-3 mr-1" />
                {operation.machineTime} {operation.machineUnit}
              </Badge>
            )}
          </>
        )}
      </HStack>
    ),
    data: operation
  };
}

function usePendingOperations() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        (fetcher.formAction === path.to.newMethodOperation ||
          fetcher.formAction?.includes("/items/methods/operation/")) ??
        false
      );
    })
    .reduce<z.infer<typeof methodOperationValidator>[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const operation = methodOperationValidator.safeParse(
        Object.fromEntries(formData)
      );

      if (operation.success) {
        return [...acc, operation.data];
      }
      return acc;
    }, []);
}

function getFieldKey(field: string, operationId: string) {
  return `${field}:${operationId}`;
}

export function MethodOperationTags({
  operation,
  availableTags
}: {
  operation: Operation;
  availableTags: { name: string }[];
}) {
  const { onUpdateTags } = useTags({
    id: operation.id,
    table: "methodOperation"
  });

  return (
    <ValidatedForm
      defaultValues={{
        tags: operation.tags ?? []
      }}
      validator={z.object({
        tags: z.array(z.string()).optional()
      })}
    >
      <Tags
        availableTags={availableTags}
        label=""
        name="tags"
        table="operation"
        inline
        maxPreview={3}
        onChange={onUpdateTags}
      />
    </ValidatedForm>
  );
}
