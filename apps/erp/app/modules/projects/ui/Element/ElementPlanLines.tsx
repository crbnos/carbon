// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
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
import { useState } from "react";
import { LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import {
  DatePicker,
  Hidden,
  Input,
  Item,
  Number as NumberField,
  Select,
  Submit
} from "~/components/Form";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter,
  useUser
} from "~/hooks";
import { methodType } from "~/modules/shared/shared.models";
import { path } from "~/utils/path";
import {
  projectElementCostValidator,
  projectElementLaborValidator,
  projectElementMaterialValidator
} from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";

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
  isDisabled
}: {
  projectId: string;
  elementId: string;
  planLines: PlanLines;
  laborCategories: { id: string; name: string }[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  const methodLabels = useMethodTypeLabels();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const action = path.to.projectElementPlan(projectId, elementId);

  const rowActions = (onEdit: () => void, onDelete: () => void) => (
    <Td className="w-16">
      <HStack spacing={0} className="justify-end">
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
              {methodLabels[line.methodType]}
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
                })
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
