// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Spinner,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  LuFactory,
  LuPencil,
  LuPlus,
  LuShoppingCart,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import {
  DatePicker,
  Hidden,
  Input,
  Item,
  Location,
  Number as NumberField,
  Select,
  Submit,
  Supplier
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { methodType } from "~/modules/shared/shared.models";
import type { loader as createPurchaseOrderLineLoader } from "~/routes/x+/project+/$projectId.elements.$elementId.create-po-line";
import { path } from "~/utils/path";
import {
  createJobFromMaterialValidator,
  createPurchaseOrderLineFromMaterialValidator,
  NEW_PURCHASE_ORDER,
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator,
  remainingMaterialQuantity
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";

type PlanLines = ProjectElementPage["planLines"];
type MaterialLine = PlanLines["materials"][number];
type LaborLine = PlanLines["labor"][number];
type CostLine = PlanLines["costs"][number];

type Editing =
  | { kind: "material"; line: MaterialLine | null }
  | { kind: "labor"; line: LaborLine | null }
  | { kind: "cost"; line: CostLine | null };

type Deleting =
  | { kind: "material"; id: string; name: string }
  | { kind: "labor"; id: string; name: string }
  | { kind: "cost"; id: string; name: string };

const DELETE_INTENT = {
  material: "deleteMaterial",
  labor: "deleteLabor",
  cost: "deleteCost"
} as const;

/**
 * The plan of one element: materials, labor and other costs. Each list adds
 * and edits its lines in a modal and posts to the plan route.
 */
export function ElementPlanLines({
  projectId,
  elementId,
  planLines,
  laborCategories,
  defaultLocationId,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  planLines: PlanLines;
  laborCategories: { id: string; name: string }[];
  /** The project's location: where a job made from a material is built. */
  defaultLocationId?: string | null;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const methodLabels = useMethodTypeLabels();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [creatingJob, setCreatingJob] = useState<MaterialLine | null>(null);
  const [creatingLine, setCreatingLine] = useState<MaterialLine | null>(null);
  const permissions = usePermissions();
  const canCreateJob = permissions.can("create", "production");
  const canCreatePurchaseOrderLine = permissions.can("create", "purchasing");
  const changeRequestId = useActiveChangeRequestId();
  const action = withChangeRequest(
    path.to.projectElementPlan(projectId, elementId),
    changeRequestId
  );

  const rowActions = (
    onEdit: () => void,
    onDelete: () => void,
    extra?: ReactNode
  ) => (
    <Td className="w-16">
      <HStack spacing={0} className="justify-end">
        {extra}
        <IconButton
          aria-label={t`Edit`}
          icon={<LuPencil />}
          variant="ghost"
          size="sm"
          isDisabled={isDisabled}
          onClick={onEdit}
        />
        <IconButton
          aria-label={t`Delete`}
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          isDisabled={isDisabled}
          onClick={onDelete}
        />
      </HStack>
    </Td>
  );

  return (
    <VStack spacing={4}>
      <PlanList
        title={t`Materials`}
        addLabel={t`Add Material`}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "material", line: null })}
        isEmpty={planLines.materials.length === 0}
        head={
          <>
            <Th>
              <Trans>Item</Trans>
            </Th>
            <Th>
              <Trans>Method</Trans>
            </Th>
            <Th>
              <Trans>Quantity</Trans>
            </Th>
            <Th>
              <Trans>Unit Cost</Trans>
            </Th>
            <Th>
              <Trans>Required</Trans>
            </Th>
            <Th />
          </>
        }
      >
        {planLines.materials.map((line) => (
          <Tr key={line.id}>
            <Td>
              <div className="flex max-w-[220px] flex-col">
                <span className="truncate">
                  {line.item?.readableIdWithRevision}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {line.item?.name}
                </span>
              </div>
            </Td>
            <Td className="whitespace-nowrap">
              <div className="flex flex-col">
                <span>{methodLabels[line.methodType]}</span>
                {line.job && (
                  <Link
                    to={path.to.job(line.job.id)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {line.job.jobId}
                  </Link>
                )}
                {line.purchaseOrderLine?.purchaseOrder && (
                  <Link
                    to={path.to.purchaseOrderDetails(
                      line.purchaseOrderLine.purchaseOrder.id
                    )}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    {line.purchaseOrderLine.purchaseOrder.purchaseOrderId}
                  </Link>
                )}
              </div>
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              {formatQuantity(Number(line.quantity))}{" "}
              {line.unitOfMeasureCode ?? ""}
            </Td>
            <Td className="tabular-nums">
              {line.unitCost === null
                ? "—"
                : formatMoney.format(Number(line.unitCost))}
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              {line.requiredDate ? formatDate(line.requiredDate) : "—"}
            </Td>
            {rowActions(
              () => setEditing({ kind: "material", line }),
              () =>
                setDeleting({
                  kind: "material",
                  id: line.id,
                  name: line.item?.readableIdWithRevision ?? t`Material`
                }),
              line.methodType === "Make to Order" && !line.jobId ? (
                <IconButton
                  aria-label={t`Create Job`}
                  icon={<LuFactory />}
                  variant="ghost"
                  size="sm"
                  isDisabled={!canCreateJob}
                  onClick={() => setCreatingJob(line)}
                />
              ) : line.methodType === "Purchase to Order" &&
                !line.purchaseOrderLineId ? (
                <IconButton
                  aria-label={t`Create PO Line`}
                  icon={<LuShoppingCart />}
                  variant="ghost"
                  size="sm"
                  isDisabled={!canCreatePurchaseOrderLine}
                  onClick={() => setCreatingLine(line)}
                />
              ) : null
            )}
          </Tr>
        ))}
      </PlanList>

      <PlanList
        title={t`Labor`}
        addLabel={t`Add Labor`}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "labor", line: null })}
        isEmpty={planLines.labor.length === 0}
        head={
          <>
            <Th>
              <Trans>Labor Category</Trans>
            </Th>
            <Th>
              <Trans>Hours</Trans>
            </Th>
            <Th>
              <Trans>Start</Trans>
            </Th>
            <Th>
              <Trans>End</Trans>
            </Th>
            <Th />
          </>
        }
      >
        {planLines.labor.map((line) => (
          <Tr key={line.id}>
            <Td className="truncate">{line.laborCategory?.name}</Td>
            <Td className="tabular-nums">
              {formatQuantity(Number(line.hours))}
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              {line.startDate ? formatDate(line.startDate) : "—"}
            </Td>
            <Td className="whitespace-nowrap tabular-nums">
              {line.endDate ? formatDate(line.endDate) : "—"}
            </Td>
            {rowActions(
              () => setEditing({ kind: "labor", line }),
              () =>
                setDeleting({
                  kind: "labor",
                  id: line.id,
                  name: line.laborCategory?.name ?? t`Labor`
                })
            )}
          </Tr>
        ))}
      </PlanList>

      <PlanList
        title={t`Other Costs`}
        addLabel={t`Add Cost`}
        isDisabled={isDisabled}
        onAdd={() => setEditing({ kind: "cost", line: null })}
        isEmpty={planLines.costs.length === 0}
        head={
          <>
            <Th>
              <Trans>Description</Trans>
            </Th>
            <Th>
              <Trans>Amount</Trans>
            </Th>
            <Th />
          </>
        }
      >
        {planLines.costs.map((line) => (
          <Tr key={line.id}>
            <Td className="max-w-[280px] truncate">{line.description}</Td>
            <Td className="tabular-nums">
              {formatMoney.format(Number(line.amount))}
            </Td>
            {rowActions(
              () => setEditing({ kind: "cost", line }),
              () =>
                setDeleting({
                  kind: "cost",
                  id: line.id,
                  name: line.description
                })
            )}
          </Tr>
        ))}
      </PlanList>

      {editing && (
        <PlanLineModal
          action={action}
          elementId={elementId}
          editing={editing}
          laborCategories={laborCategories}
          onClose={() => setEditing(null)}
        />
      )}
      {creatingJob && (
        <CreateJobModal
          projectId={projectId}
          elementId={elementId}
          line={creatingJob}
          defaultLocationId={defaultLocationId}
          onClose={() => setCreatingJob(null)}
        />
      )}
      {creatingLine && (
        <CreatePurchaseOrderLineModal
          projectId={projectId}
          elementId={elementId}
          line={creatingLine}
          onClose={() => setCreatingLine(null)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={action}
          name={deleting.name}
          text={t`Remove ${deleting.name} from the plan?`}
          fields={{ intent: DELETE_INTENT[deleting.kind], id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </VStack>
  );
}

function useMethodTypeLabels(): Record<(typeof methodType)[number], string> {
  const { t } = useLingui();
  return {
    "Purchase to Order": t`Purchase to Order`,
    "Pull from Inventory": t`Pull from Inventory`,
    "Make to Order": t`Make to Order`
  };
}

function PlanList({
  title,
  addLabel,
  isDisabled,
  isEmpty,
  onAdd,
  head,
  children
}: {
  title: string;
  addLabel: string;
  isDisabled: boolean;
  isEmpty: boolean;
  onAdd: () => void;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full">
      <HStack className="mb-1 w-full justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LuPlus />}
          isDisabled={isDisabled}
          onClick={onAdd}
        >
          {addLabel}
        </Button>
      </HStack>
      {isEmpty ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          <Trans>Nothing planned yet</Trans>
        </p>
      ) : (
        <div className="w-full overflow-x-auto rounded-md border border-border">
          <TableBase full>
            <Thead>
              <Tr>{head}</Tr>
            </Thead>
            <Tbody>{children}</Tbody>
          </TableBase>
        </div>
      )}
    </div>
  );
}

function PlanLineModal({
  action,
  elementId,
  editing,
  laborCategories,
  onClose
}: {
  action: string;
  elementId: string;
  editing: Editing;
  laborCategories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const currency = company.baseCurrencyCode;
  const decimals = useCurrencyDecimals(currency);
  const methodLabels = useMethodTypeLabels();
  const fetcher = useAction<{ success?: boolean }>({
    onSuccess: () => onClose()
  });
  const isNew = editing.line === null;

  const title =
    editing.kind === "material"
      ? isNew
        ? t`Add Material`
        : t`Edit Material`
      : editing.kind === "labor"
        ? isNew
          ? t`Add Labor`
          : t`Edit Labor`
        : isNew
          ? t`Add Cost`
          : t`Edit Cost`;

  const body = (() => {
    switch (editing.kind) {
      case "material": {
        const line = editing.line;
        return (
          <ValidatedForm
            validator={projectElementMaterialValidator}
            method="post"
            action={action}
            fetcher={fetcher}
            defaultValues={{
              id: line?.id,
              projectElementId: elementId,
              itemId: line?.itemId ?? "",
              methodType: line?.methodType ?? "Pull from Inventory",
              quantity: line ? Number(line.quantity) : 1,
              unitCost:
                line?.unitCost === null || line?.unitCost === undefined
                  ? undefined
                  : Number(line.unitCost),
              requiredDate: line?.requiredDate ?? undefined
            }}
          >
            <ModalBody>
              <Hidden name="intent" value="upsertMaterial" />
              <Hidden name="id" />
              <Hidden name="projectElementId" />
              <VStack spacing={4}>
                <Item name="itemId" label={t`Item`} type="Item" />
                <Select
                  name="methodType"
                  label={t`Method`}
                  options={methodType.map((value) => ({
                    value,
                    label: methodLabels[value]
                  }))}
                />
                <NumberField
                  name="quantity"
                  label={t`Quantity`}
                  minValue={0}
                  formatOptions={INPUT_FORMAT.quantity}
                  step={INPUT_STEP.quantity}
                />
                <NumberField
                  name="unitCost"
                  label={t`Unit Cost`}
                  minValue={0}
                  formatOptions={INPUT_FORMAT.rate(currency, decimals)}
                  step={INPUT_STEP.rate}
                />
                <DatePicker name="requiredDate" label={t`Required Date`} />
              </VStack>
            </ModalBody>
            <PlanLineFooter onClose={onClose} />
          </ValidatedForm>
        );
      }
      case "labor": {
        const line = editing.line;
        return (
          <ValidatedForm
            validator={projectElementLaborValidator}
            method="post"
            action={action}
            fetcher={fetcher}
            defaultValues={{
              id: line?.id,
              projectElementId: elementId,
              laborCategoryId: line?.laborCategoryId ?? "",
              hours: line ? Number(line.hours) : 1,
              startDate: line?.startDate ?? undefined,
              endDate: line?.endDate ?? undefined
            }}
          >
            <ModalBody>
              <Hidden name="intent" value="upsertLabor" />
              <Hidden name="id" />
              <Hidden name="projectElementId" />
              <VStack spacing={4}>
                <Select
                  name="laborCategoryId"
                  label={t`Labor Category`}
                  options={laborCategories.map((c) => ({
                    value: c.id,
                    label: c.name
                  }))}
                />
                <NumberField
                  name="hours"
                  label={t`Hours`}
                  minValue={0}
                  formatOptions={INPUT_FORMAT.quantity}
                  step={INPUT_STEP.quantity}
                />
                <DatePicker name="startDate" label={t`Start Date`} />
                <DatePicker name="endDate" label={t`End Date`} />
              </VStack>
            </ModalBody>
            <PlanLineFooter onClose={onClose} />
          </ValidatedForm>
        );
      }
      case "cost": {
        const line = editing.line;
        return (
          <ValidatedForm
            validator={projectElementCostValidator}
            method="post"
            action={action}
            fetcher={fetcher}
            defaultValues={{
              id: line?.id,
              projectElementId: elementId,
              description: line?.description ?? "",
              amount: line ? Number(line.amount) : 0
            }}
          >
            <ModalBody>
              <Hidden name="intent" value="upsertCost" />
              <Hidden name="id" />
              <Hidden name="projectElementId" />
              <VStack spacing={4}>
                <Input name="description" label={t`Description`} />
                <NumberField
                  name="amount"
                  label={t`Amount`}
                  formatOptions={INPUT_FORMAT.money(currency, decimals)}
                  step={INPUT_STEP.money(decimals)}
                />
              </VStack>
            </ModalBody>
            <PlanLineFooter onClose={onClose} />
          </ValidatedForm>
        );
      }
    }
  })();

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
        </ModalHeader>
        {body}
      </ModalContent>
    </Modal>
  );
}

/**
 * Create Job for a Make to Order material: the quantity still needed, by the
 * plan line's required date, at the project's location. The action
 * redirects to the new job; a refusal shows in the modal.
 */
function CreateJobModal({
  projectId,
  elementId,
  line,
  defaultLocationId,
  onClose
}: {
  projectId: string;
  elementId: string;
  line: MaterialLine;
  defaultLocationId?: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { defaults } = useUser();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={createJobFromMaterialValidator}
          method="post"
          action={path.to.projectElementCreateJob(projectId, elementId)}
          fetcher={fetcher}
          defaultValues={{
            materialId: line.id,
            quantity: remainingMaterialQuantity(line) || Number(line.quantity),
            dueDate: line.requiredDate ?? undefined,
            locationId: defaultLocationId ?? defaults?.locationId ?? ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create Job</Trans>
            </ModalTitle>
            <ModalDescription>
              {line.item?.readableIdWithRevision} {line.item?.name}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="materialId" />
            <VStack spacing={4}>
              {errorMessage && (
                <Alert variant="destructive">
                  <LuTriangleAlert />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              <NumberField
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <DatePicker name="dueDate" label={t`Due Date`} />
              <Location name="locationId" label={t`Location`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Create Job</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * Create PO line for a Purchase to Order material: the supplier (the item's
 * preferred one first), the quantity still needed in the plan line's unit,
 * the required date, and the supplier's Draft purchase order at the
 * project's location to add to, or a new one. The action redirects to the
 * purchase order; a refusal shows in the modal.
 */
function CreatePurchaseOrderLineModal({
  projectId,
  elementId,
  line,
  onClose
}: {
  projectId: string;
  elementId: string;
  line: MaterialLine;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const resource = path.to.projectElementCreatePurchaseOrderLine(
    projectId,
    elementId
  );
  const optionsFetcher = useFetcher<typeof createPurchaseOrderLineLoader>();
  const fetcher = useAction<{ error?: { message: string } }>();
  const errorMessage =
    fetcher.state === "idle" ? fetcher.data?.error?.message : undefined;
  // Undefined until the user picks a supplier: the loader's preferred one.
  const [pickedSupplierId, setPickedSupplierId] = useState<string>();

  const load = optionsFetcher.load;
  useEffect(() => {
    const params = new URLSearchParams({ materialId: line.id });
    if (pickedSupplierId) params.set("supplierId", pickedSupplierId);
    load(`${resource}?${params}`);
  }, [load, resource, line.id, pickedSupplierId]);

  const options = optionsFetcher.data;
  const purchaseOrderOptions = [
    { value: NEW_PURCHASE_ORDER, label: t`New purchase order` },
    ...(options?.purchaseOrders ?? []).map((po) => ({
      value: po.id,
      label: po.purchaseOrderId
    }))
  ];

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        {options === undefined ? (
          <ModalBody>
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          </ModalBody>
        ) : (
          <ValidatedForm
            // The options of a newly picked supplier restart the form with
            // its purchase orders.
            key={options.supplierId ?? ""}
            validator={createPurchaseOrderLineFromMaterialValidator}
            method="post"
            action={resource}
            fetcher={fetcher}
            defaultValues={{
              materialId: line.id,
              supplierId: options.supplierId ?? "",
              quantity:
                remainingMaterialQuantity(line) || Number(line.quantity),
              requiredDate: line.requiredDate ?? undefined,
              purchaseOrderId:
                options.purchaseOrders[0]?.id ?? NEW_PURCHASE_ORDER
            }}
          >
            <ModalHeader>
              <ModalTitle>
                <Trans>Create PO Line</Trans>
              </ModalTitle>
              <ModalDescription>
                {line.item?.readableIdWithRevision} {line.item?.name}
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              <Hidden name="materialId" />
              <VStack spacing={4}>
                {errorMessage && (
                  <Alert variant="destructive">
                    <LuTriangleAlert />
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                )}
                <Supplier
                  name="supplierId"
                  label={t`Supplier`}
                  onChange={(option) => {
                    if (option?.value && option.value !== options.supplierId) {
                      setPickedSupplierId(option.value);
                    }
                  }}
                />
                <NumberField
                  name="quantity"
                  label={t`Quantity`}
                  helperText={
                    line.unitOfMeasureCode
                      ? t`In ${line.unitOfMeasureCode}; the supplier part's conversion factor gives the purchase quantity`
                      : t`The supplier part's conversion factor gives the purchase quantity`
                  }
                  minValue={0}
                  formatOptions={INPUT_FORMAT.quantity}
                  step={INPUT_STEP.quantity}
                />
                <DatePicker name="requiredDate" label={t`Required Date`} />
                <Select
                  name="purchaseOrderId"
                  label={t`Add to`}
                  options={purchaseOrderOptions}
                />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false}>
                <Trans>Create PO Line</Trans>
              </Submit>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}

function PlanLineFooter({ onClose }: { onClose: () => void }) {
  return (
    <ModalFooter>
      <Button variant="secondary" onClick={onClose}>
        <Trans>Cancel</Trans>
      </Button>
      <Submit withBlocker={false}>
        <Trans>Save</Trans>
      </Submit>
    </ModalFooter>
  );
}
