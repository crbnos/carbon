import { Hidden, NumberControlled, Submit, ValidatedForm } from "@carbon/form";
import {
  cn,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuUndo2, LuX } from "react-icons/lu";
import type { z } from "zod";
import { completeJobOperationBatchValidator } from "~/services/models";
import type { JobOperationBatch } from "~/services/operations.service";
import { path } from "~/utils/path";

// The batch completion form, opened from the batched operation view. Posts to
// batch.$batchId.complete (the same action the retired batch page used), which
// invokes the batch-operations edge fn: slice the shared timers per member,
// record quantities, flip members Done + batch Completed. A phase-2 failure
// leaves the batch Completing and re-submitting resumes without double effects.
export function BatchCompleteModal({
  batch,
  isCompleting,
  hasOpenEvent,
  onClose
}: {
  batch: JobOperationBatch;
  isCompleting: boolean;
  hasOpenEvent: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const members = batch.operations ?? [];

  const initialValues = {
    batchId: batch.id as string,
    members: members.map((m) => ({
      jobOperationId: m.id,
      // Pre-fill with the operation quantity less any already completed (spec).
      quantity: Math.max(
        0,
        (m.operationQuantity ?? 0) - (m.quantityComplete ?? 0)
      ),
      scrapQuantity: 0
    }))
  } satisfies z.infer<typeof completeJobOperationBatchValidator>;

  // Controlled per-member quantities: react-aria NumberField does not pick up
  // RVF's nested-array defaults, so drive the values with local state instead.
  // `excluded` = "not in this run": the operation detaches back to the schedule
  // un-run instead of being marked Done.
  const [rows, setRows] = useState(
    initialValues.members.map((m) => ({
      quantity: m.quantity,
      scrapQuantity: m.scrapQuantity,
      excluded: false
    }))
  );
  const setRow = (i: number, key: "quantity" | "scrapQuantity", v: number) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [key]: v } : r))
    );
  const toggleExcluded = (i: number) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, excluded: !r.excluded } : r))
    );

  const allExcluded = rows.every((r) => r.excluded);
  const anyExcluded = rows.some((r) => r.excluded);
  // An included row completing at 0 still flips the operation Done with no
  // output — legal, but worth a loud heads-up.
  const anyZeroIncluded = rows.some((r) => !r.excluded && r.quantity === 0);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <ModalTitle>
            <Trans>Complete Batch</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Time and cost split across jobs proportionally to quantity.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          method="post"
          action={path.to.batchComplete(batch.id as string)}
          validator={completeJobOperationBatchValidator}
          defaultValues={initialValues}
        >
          <ModalBody>
            <Hidden name="batchId" value={batch.id as string} />
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Job</Trans>
                  </Th>
                  <Th>
                    <Trans>Operation</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Scrap</Trans>
                  </Th>
                  <Th className="w-10" />
                </Tr>
              </Thead>
              <Tbody>
                {members.map((m, i) => {
                  const isExcluded = rows[i]?.excluded ?? false;
                  return (
                    <Tr key={m.id} className={cn(isExcluded && "opacity-50")}>
                      <Td className="font-medium">
                        {(m.job as { jobId?: string | null } | null)?.jobId}
                      </Td>
                      <Td className="text-muted-foreground">{m.description}</Td>
                      <Td className="text-right">
                        <Hidden
                          name={`members[${i}].jobOperationId`}
                          value={m.id}
                        />
                        <Hidden
                          name={`members[${i}].excluded`}
                          value={isExcluded ? "true" : ""}
                        />
                        <NumberControlled
                          name={`members[${i}].quantity`}
                          label=""
                          size="lg"
                          value={isExcluded ? 0 : (rows[i]?.quantity ?? 0)}
                          onChange={(v) => setRow(i, "quantity", v)}
                          minValue={0}
                          className="max-w-[120px] ml-auto"
                          isDisabled={isExcluded}
                        />
                      </Td>
                      <Td className="text-right">
                        <NumberControlled
                          name={`members[${i}].scrapQuantity`}
                          label=""
                          size="lg"
                          value={isExcluded ? 0 : (rows[i]?.scrapQuantity ?? 0)}
                          onChange={(v) => setRow(i, "scrapQuantity", v)}
                          minValue={0}
                          className="max-w-[120px] ml-auto"
                          isDisabled={isExcluded}
                        />
                      </Td>
                      <Td className="text-right">
                        <IconButton
                          aria-label={
                            isExcluded ? t`Include in run` : t`Not in this run`
                          }
                          title={
                            isExcluded ? t`Include in run` : t`Not in this run`
                          }
                          icon={isExcluded ? <LuUndo2 /> : <LuX />}
                          variant="ghost"
                          size="lg"
                          className="text-muted-foreground"
                          onClick={() => toggleExcluded(i)}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
            {hasOpenEvent && (
              <p className="mt-3 text-xs text-muted-foreground">
                <Trans>Stop the timer before completing the batch.</Trans>
              </p>
            )}
            {anyExcluded && (
              <p className="mt-3 text-xs text-muted-foreground">
                <Trans>
                  Excluded operations return to the schedule un-run — no time or
                  quantity is recorded for them.
                </Trans>
              </p>
            )}
            {anyZeroIncluded && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                <Trans>
                  An operation completed with 0 is marked Done with no output —
                  exclude it instead if it was not part of this run.
                </Trans>
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <Submit size="lg" isDisabled={hasOpenEvent || allExcluded}>
              {isCompleting ? t`Retry Completion` : t`Complete Batch`}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
