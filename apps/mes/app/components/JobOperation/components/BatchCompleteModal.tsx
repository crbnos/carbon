import { Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import { completeJobOperationBatchValidator } from "~/services/models";
import type { JobOperationBatch } from "~/services/operations.service";
import { path } from "~/utils/path";

// Spreadsheet-style numeric cell — a bare input (no react-aria stepper arrows),
// full-cell, right-aligned monospace numerals, focus ring inset so it never
// breaks the grid lines. Mirrors the MES inspection matrix.
const cellInputClass =
  "block h-full min-h-12 w-full bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");
const toNumber = (value: string) => Number(value) || 0;

// The batch completion form, opened from the batched operation view. Posts to
// batch.$batchId.complete (the same action the retired batch page used), which
// invokes the batch-operations edge fn: slice the shared timers per member,
// record quantities, flip members Done + batch Completed. A phase-2 failure
// leaves the batch Completing and re-submitting resumes without double effects.
export function BatchCompleteModal({
  batch,
  isCompleting,
  onClose
}: {
  batch: JobOperationBatch;
  isCompleting: boolean;
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

  // Controlled per-member quantities as strings (empty while typing): react-aria
  // would add stepper chrome, so the grid uses bare inputs and drives them here.
  // A member left at 0 quantity AND 0 scrap is "not in this run" — it detaches
  // back to the schedule un-run instead of being marked Done (no explicit toggle;
  // just leave the row at 0).
  const [rows, setRows] = useState(
    initialValues.members.map((m) => ({
      quantity: String(m.quantity),
      scrapQuantity: String(m.scrapQuantity)
    }))
  );
  const setRow = (i: number, key: "quantity" | "scrapQuantity", v: string) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [key]: digitsOnly(v) } : r))
    );

  const isExcludedRow = (i: number) =>
    toNumber(rows[i]?.quantity ?? "0") === 0 &&
    toNumber(rows[i]?.scrapQuantity ?? "0") === 0;
  const allExcluded = rows.every(
    (r) => toNumber(r.quantity) === 0 && toNumber(r.scrapQuantity) === 0
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large" withCloseButton={false}>
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
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="border-b border-r border-border px-3 py-2 text-left font-medium text-muted-foreground">
                      <Trans>Job</Trans>
                    </th>
                    <th className="w-[140px] border-b border-r border-border px-3 py-2 text-right font-medium text-muted-foreground">
                      <Trans>Quantity</Trans>
                    </th>
                    <th className="w-[140px] border-b border-border px-3 py-2 text-right font-medium text-muted-foreground">
                      <Trans>Scrap</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => {
                    const isExcluded = isExcludedRow(i);
                    const isLast = i === members.length - 1;
                    return (
                      <tr key={m.id} className={cn(isExcluded && "opacity-50")}>
                        <td
                          className={cn(
                            "border-r border-border px-3 py-2 align-middle font-medium tabular-nums",
                            !isLast && "border-b"
                          )}
                        >
                          {(m.job as { jobId?: string | null } | null)?.jobId}
                          <Hidden
                            name={`members[${i}].jobOperationId`}
                            value={m.id}
                          />
                          <Hidden
                            name={`members[${i}].excluded`}
                            value={isExcluded ? "true" : ""}
                          />
                        </td>
                        <td
                          className={cn(
                            "border-r border-border p-0 align-middle",
                            !isLast && "border-b"
                          )}
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            name={`members[${i}].quantity`}
                            aria-label={t`Quantity`}
                            value={rows[i]?.quantity ?? ""}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) =>
                              setRow(i, "quantity", e.target.value)
                            }
                            className={cellInputClass}
                          />
                        </td>
                        <td
                          className={cn(
                            "border-border p-0 align-middle",
                            !isLast && "border-b"
                          )}
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            name={`members[${i}].scrapQuantity`}
                            aria-label={t`Scrap`}
                            value={rows[i]?.scrapQuantity ?? ""}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) =>
                              setRow(i, "scrapQuantity", e.target.value)
                            }
                            className={cellInputClass}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-pretty text-xs text-muted-foreground">
              <Trans>
                Leave an operation at 0 to skip it — it returns to the schedule
                un-run with no time or quantity recorded.
              </Trans>
            </p>
          </ModalBody>
          <ModalFooter>
            <Submit size="lg" isDisabled={allExcluded}>
              {isCompleting ? t`Retry Completion` : t`Complete Batch`}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
