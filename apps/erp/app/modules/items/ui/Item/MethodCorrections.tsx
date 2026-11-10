// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { LuPencil, LuPlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Hidden,
  Input,
  Number as NumberForm,
  Select as SelectForm,
  Submit
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  correctionReturnTo,
  inspectionFailedResult,
  methodCorrectionValidator
} from "../../items.models";
import BillOfMaterial from "./BillOfMaterial";
import BillOfProcess from "./BillOfProcess";

type Correction = Database["public"]["Tables"]["methodCorrection"]["Row"];
type CorrectionTrigger =
  Database["public"]["Tables"]["methodCorrectionTrigger"]["Row"];
type BillOfProcessProps = ComponentProps<typeof BillOfProcess>;
type BillOfMaterialProps = ComponentProps<typeof BillOfMaterial>;
type RoutingOperation = BillOfProcessProps["operations"][number];
type RoutingStep = RoutingOperation["methodOperationStep"][number];

type MethodCorrectionsProps = {
  makeMethod: BillOfProcessProps["makeMethod"];
  corrections: Correction[];
  triggers: CorrectionTrigger[];
  /** The corrections' operations (methodCorrectionId set). */
  operations: BillOfProcessProps["operations"];
  /** The corrections' materials (methodCorrectionId set). */
  materials: BillOfMaterialProps["materials"];
  /** The normal routing, whose step results map to corrections. */
  routingOperations: BillOfProcessProps["operations"];
  tags: BillOfProcessProps["tags"];
} & Pick<BillOfProcessProps, "revisionStatus" | "releaseControl">;

/** One step result that can suggest a correction. */
type MappableResult = {
  operation: RoutingOperation;
  step: RoutingStep;
  listValue?: string;
  measurementCondition?: "Below Minimum" | "Above Maximum";
};

/**
 * Shapes `getMethodCorrectionsData` rows for the editors, the way the make
 * method pages shape the normal routing (nulls to undefined for the forms).
 */
export function toMethodCorrectionsProps(
  data: {
    corrections: Correction[];
    triggers: CorrectionTrigger[];
    operations: Array<Record<string, any>>;
    materials: Array<Record<string, any>>;
  } | null
) {
  return {
    corrections: data?.corrections ?? [],
    triggers: data?.triggers ?? [],
    operations: (data?.operations ?? []).map((operation) => ({
      ...operation,
      description: operation.description ?? "",
      procedureId: operation.procedureId ?? undefined,
      assemblyInstructionId: operation.assemblyInstructionId ?? undefined,
      inspectionDocumentId: operation.inspectionDocumentId ?? undefined,
      operationSupplierProcessId:
        operation.operationSupplierProcessId ?? undefined,
      operationMinimumCost: operation.operationMinimumCost ?? 0,
      operationLeadTime: operation.operationLeadTime ?? 0,
      operationUnitCost: operation.operationUnitCost ?? 0,
      tags: operation.tags ?? [],
      workCenterId: operation.workCenterId ?? undefined
    })) as unknown as BillOfProcessProps["operations"],
    materials: (data?.materials ?? []).map((material) => ({
      ...material,
      description: material.item?.name ?? "",
      methodOperationId: material.methodOperationId ?? undefined
    })) as unknown as BillOfMaterialProps["materials"]
  };
}

const NO_CORRECTION = "none";

/**
 * A make method's corrections: rework-only routings a step result suggests.
 * Each correction edits its operations and materials with the same Bill of
 * Process and Bill of Material editors as the normal routing.
 */
export default function MethodCorrections({
  makeMethod,
  corrections,
  triggers,
  operations,
  materials,
  routingOperations,
  tags,
  revisionStatus,
  releaseControl
}: MethodCorrectionsProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isReadOnly =
    !permissions.can("update", "parts") || makeMethod.status !== "Draft";

  const formModal = useDisclosure();
  const [editing, setEditing] = useState<Correction | null>(null);
  // Kept after close so the dialog keeps its text while it animates out.
  const [deleting, setDeleting] = useState<Correction | null>(null);
  const deleteModal = useDisclosure();

  const openNew = () => {
    setEditing(null);
    formModal.onOpen();
  };
  const openEdit = (correction: Correction) => {
    setEditing(correction);
    formModal.onOpen();
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>
            <Trans>Corrections</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Rework-only operations that a step result suggests, such as a
              re-torque when a check finds a nut too loose. Normal units never
              run them.
            </Trans>
          </CardDescription>
        </CardHeader>
        {!isReadOnly && (
          <Button
            variant="secondary"
            leftIcon={<LuPlus />}
            className="mr-6"
            onClick={openNew}
          >
            <Trans>New Correction</Trans>
          </Button>
        )}
      </HStack>
      <CardContent>
        <VStack spacing={8}>
          {corrections.length === 0 && (
            <span className="text-sm text-muted-foreground">
              <Trans>No corrections yet.</Trans>
            </span>
          )}
          {corrections.map((correction) => (
            <VStack key={correction.id} spacing={3} className="w-full">
              <HStack className="w-full justify-between">
                <HStack spacing={2}>
                  <span className="font-semibold">{correction.name}</span>
                  <Badge variant="outline">
                    {correction.returnTo === "Continue"
                      ? t`Then continue`
                      : t`Then re-inspect`}
                  </Badge>
                  {correction.maxAttempts !== null && (
                    <Badge variant="secondary">
                      {t`Max ${correction.maxAttempts} per unit`}
                    </Badge>
                  )}
                </HStack>
                {!isReadOnly && (
                  <HStack spacing={1}>
                    <IconButton
                      aria-label={t`Edit correction`}
                      icon={<LuPencil />}
                      variant="ghost"
                      onClick={() => openEdit(correction)}
                    />
                    <IconButton
                      aria-label={t`Delete correction`}
                      icon={<LuTrash />}
                      variant="ghost"
                      onClick={() => {
                        setDeleting(correction);
                        deleteModal.onOpen();
                      }}
                    />
                  </HStack>
                )}
              </HStack>
              {correction.description && (
                <span className="text-sm text-muted-foreground">
                  {correction.description}
                </span>
              )}
              <BillOfProcess
                key={`correction-bop:${correction.id}`}
                makeMethod={makeMethod}
                methodCorrectionId={correction.id}
                title={t`Operations`}
                // The editors type the same rows differently; the make method
                // pages cast them the same way.
                materials={
                  materials.filter(
                    (material) => material.methodCorrectionId === correction.id
                  ) as never
                }
                operations={operations.filter(
                  (operation) => operation.methodCorrectionId === correction.id
                )}
                tags={tags}
                revisionStatus={revisionStatus}
                releaseControl={releaseControl}
              />
              <BillOfMaterial
                key={`correction-bom:${correction.id}`}
                makeMethod={makeMethod}
                methodCorrectionId={correction.id}
                title={t`Materials`}
                materials={materials.filter(
                  (material) => material.methodCorrectionId === correction.id
                )}
                operations={
                  operations.filter(
                    (operation) =>
                      operation.methodCorrectionId === correction.id
                  ) as never
                }
                revisionStatus={revisionStatus}
                releaseControl={releaseControl}
              />
            </VStack>
          ))}

          {corrections.length > 0 && (
            <ResultMappings
              corrections={corrections}
              triggers={triggers}
              routingOperations={routingOperations}
              isReadOnly={isReadOnly}
            />
          )}
        </VStack>
      </CardContent>

      <CorrectionFormModal
        open={formModal.isOpen}
        onClose={formModal.onClose}
        makeMethodId={makeMethod.id}
        correction={editing}
      />

      <ConfirmDelete
        isOpen={deleteModal.isOpen}
        action={
          deleting ? path.to.methodCorrectionDelete(deleting.id) : undefined
        }
        name={deleting?.name ?? ""}
        text={t`Deleting this correction removes its operations, materials and result mappings. Jobs already created keep their own copy.`}
        onCancel={deleteModal.onClose}
        onSubmit={deleteModal.onClose}
      />
    </Card>
  );
}

function CorrectionFormModal({
  open,
  onClose,
  makeMethodId,
  correction
}: {
  open: boolean;
  onClose: () => void;
  makeMethodId: string;
  correction: Correction | null;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ id?: string | null; fieldErrors?: unknown }>();

  // Close once a save comes back without field errors.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.id) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          key={correction?.id ?? "new"}
          method="post"
          action={
            correction
              ? path.to.methodCorrection(correction.id)
              : path.to.newMethodCorrection
          }
          validator={methodCorrectionValidator}
          fetcher={fetcher}
          defaultValues={{
            makeMethodId,
            name: correction?.name ?? "",
            description: correction?.description ?? "",
            returnTo: correction?.returnTo ?? "Re-inspect",
            maxAttempts: correction?.maxAttempts ?? undefined,
            order: correction?.order ?? undefined
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {correction ? (
                <Trans>Edit Correction</Trans>
              ) : (
                <Trans>New Correction</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="makeMethodId" />
            <Hidden name="order" />
            <VStack spacing={4}>
              <Input
                name="name"
                label={t`Name`}
                placeholder={t`Re-torque nut`}
              />
              <Input name="description" label={t`Description`} />
              <SelectForm
                name="returnTo"
                label={t`After the correction`}
                options={correctionReturnTo.map((value) => ({
                  value,
                  label:
                    value === "Continue"
                      ? t`Continue to the next operation`
                      : t`Re-inspect at the operation that found it`
                }))}
              />
              <NumberForm
                name="maxAttempts"
                label={t`Max attempts per unit`}
                helperText={t`Leave empty for no limit. Past it, MES offers only Scrap or a quality issue.`}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

/**
 * Which correction each step result suggests: List and Inspection values, and
 * Measurement results below the minimum or above the maximum.
 */
function ResultMappings({
  corrections,
  triggers,
  routingOperations,
  isReadOnly
}: {
  corrections: Correction[];
  triggers: CorrectionTrigger[];
  routingOperations: BillOfProcessProps["operations"];
  isReadOnly: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();

  const results = useMemo<MappableResult[]>(
    () =>
      routingOperations.flatMap((operation) =>
        (operation.methodOperationStep ?? []).flatMap(
          (step): MappableResult[] => {
            if (step.type === "List") {
              return (step.listValues ?? []).map((listValue) => ({
                operation,
                step,
                listValue
              }));
            }
            // An Inspection records pass or fail: a fail is its one result.
            if (step.type === "Inspection") {
              return [{ operation, step, listValue: inspectionFailedResult }];
            }
            if (step.type === "Measurement") {
              const rows: MappableResult[] = [];
              if (step.minValue !== null && step.minValue !== undefined) {
                rows.push({
                  operation,
                  step,
                  measurementCondition: "Below Minimum"
                });
              }
              if (step.maxValue !== null && step.maxValue !== undefined) {
                rows.push({
                  operation,
                  step,
                  measurementCondition: "Above Maximum"
                });
              }
              return rows;
            }
            return [];
          }
        )
      ),
    [routingOperations]
  );

  const mappedCorrection = (result: MappableResult) =>
    triggers.find(
      (trigger) =>
        trigger.methodOperationStepId === result.step.id &&
        (result.listValue !== undefined
          ? trigger.listValue === result.listValue
          : trigger.measurementCondition === result.measurementCondition)
    )?.methodCorrectionId;

  const onMap = (result: MappableResult, value: string) => {
    if (!result.step.id) return;
    const formData = new FormData();
    formData.append("methodOperationStepId", result.step.id);
    formData.append("methodCorrectionId", value === NO_CORRECTION ? "" : value);
    if (result.listValue !== undefined) {
      formData.append("listValue", result.listValue);
    } else if (result.measurementCondition) {
      formData.append("measurementCondition", result.measurementCondition);
    }
    fetcher.submit(formData, {
      method: "post",
      action: path.to.methodCorrectionTrigger
    });
  };

  return (
    <VStack spacing={2} className="w-full">
      <span className="font-semibold">
        <Trans>Result mappings</Trans>
      </span>
      {results.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          <Trans>
            Add a List, Inspection or Measurement (with a min or max) step to an
            operation to map its results to corrections.
          </Trans>
        </span>
      ) : (
        <div className="w-full divide-y border rounded-md">
          {results.map((result) => (
            <div
              key={`${result.step.id}:${result.listValue ?? result.measurementCondition}`}
              className="flex items-center justify-between gap-4 px-3 py-2"
            >
              <span className="text-sm min-w-0 truncate">
                {result.operation.description} · {result.step.name} ·{" "}
                <span className="font-medium">
                  {result.step.type === "Inspection"
                    ? t`Failed inspection`
                    : (result.listValue ??
                      (result.measurementCondition === "Below Minimum"
                        ? t`Below ${result.step.minValue}`
                        : t`Above ${result.step.maxValue}`))}
                </span>
              </span>
              <Select
                value={mappedCorrection(result) ?? NO_CORRECTION}
                onValueChange={(value) => onMap(result, value)}
                disabled={isReadOnly}
              >
                <SelectTrigger className="w-56 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CORRECTION}>
                    {t`No correction`}
                  </SelectItem>
                  {corrections.map((correction) => (
                    <SelectItem key={correction.id} value={correction.id}>
                      {correction.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </VStack>
  );
}
