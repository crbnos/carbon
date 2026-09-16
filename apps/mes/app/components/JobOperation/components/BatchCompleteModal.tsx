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
import type { useFetcher } from "react-router";
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
  fetcher,
  onClose
}: {
  batch: JobOperationBatch;
  isCompleting: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const members = batch.operations ?? [];
  // Any member producing a batch-tracked item gets a batch-number column; its
  // WIP entity is finalized as the produced lot at completion.
  const anyTracked = members.some((m) => m.requiresBatchTracking);

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

  // Operator-editable batch numbers, pre-filled from each member's WIP entity.
  const [batchNumbers, setBatchNumbers] = useState(
    members.map((m) => m.batchNumber ?? "")
  );

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

  // A member that will produce a lot (batch-tracked, quantity > 0) must carry
  // a batch number: completing without one mints an Available lot with no
  // readable number. Pre-filled when the job's batch number property (the WIP
  // entity's readableId, editable in the job detail sidebar) was set.
  const requiresNumber = (i: number) => {
    const m = members[i];
    return Boolean(
      m?.requiresBatchTracking &&
        m?.trackedEntityId &&
        toNumber(rows[i]?.quantity ?? "0") > 0
    );
  };
  const missingBatchNumbers = members.some(
    (_, i) => requiresNumber(i) && !(batchNumbers[i] ?? "").trim()
  );

  // Rows sharing a batch number complete into ONE merged lot — the number IS
  // the merge intent, confirmed inline instead of a second prompt after
  // completion. The same number across DIFFERENT items can never merge, and
  // two separate lots with one number is worse than either: block submit so
  // the operator edits the numbers instead.
  const numberGroups = new Map<
    string,
    { indexes: number[]; items: Set<string> }
  >();
  members.forEach((m, i) => {
    if (!requiresNumber(i)) return;
    const number = (batchNumbers[i] ?? "").trim();
    if (!number) return;
    const group = numberGroups.get(number) ?? {
      indexes: [],
      items: new Set<string>()
    };
    group.indexes.push(i);
    if (m.itemId) group.items.add(m.itemId);
    numberGroups.set(number, group);
  });
  const mergeGroups = [...numberGroups.entries()].filter(
    ([, g]) => g.indexes.length > 1 && g.items.size <= 1
  );
  const conflictGroups = [...numberGroups.entries()].filter(
    ([, g]) => g.indexes.length > 1 && g.items.size > 1
  );
  const conflictIndexes = new Set(conflictGroups.flatMap(([, g]) => g.indexes));

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
          fetcher={fetcher}
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
                    <th
                      className={cn(
                        "w-[140px] border-b border-border px-3 py-2 text-right font-medium text-muted-foreground",
                        anyTracked && "border-r"
                      )}
                    >
                      <Trans>Scrap</Trans>
                    </th>
                    {anyTracked && (
                      <th className="w-[180px] border-b border-border px-3 py-2 text-left font-medium text-muted-foreground">
                        <Trans>Batch Number</Trans>
                      </th>
                    )}
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
                          {m.requiresBatchTracking && m.trackedEntityId && (
                            <Hidden
                              name={`members[${i}].trackedEntityId`}
                              value={m.trackedEntityId}
                            />
                          )}
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
                            anyTracked && "border-r",
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
                        {anyTracked && (
                          <td
                            className={cn(
                              "border-border p-0 align-middle",
                              !isLast && "border-b"
                            )}
                          >
                            {m.requiresBatchTracking && m.trackedEntityId ? (
                              <input
                                type="text"
                                name={`members[${i}].batchNumber`}
                                aria-label={t`Batch Number`}
                                value={batchNumbers[i] ?? ""}
                                onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) =>
                                  setBatchNumbers((prev) =>
                                    prev.map((v, idx) =>
                                      idx === i ? e.target.value : v
                                    )
                                  )
                                }
                                placeholder={t`Required`}
                                aria-invalid={
                                  (requiresNumber(i) &&
                                    !(batchNumbers[i] ?? "").trim()) ||
                                  conflictIndexes.has(i)
                                }
                                className={cn(
                                  cellInputClass,
                                  "text-left font-mono placeholder:text-muted-foreground/50",
                                  ((requiresNumber(i) &&
                                    !(batchNumbers[i] ?? "").trim()) ||
                                    conflictIndexes.has(i)) &&
                                    "ring-1 ring-inset ring-destructive/40"
                                )}
                              />
                            ) : null}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {conflictGroups.map(([number]) => (
              <p
                key={number}
                className="mt-3 text-pretty text-xs text-destructive"
              >
                <Trans>
                  Batch number {number} is used for different items — lots of
                  different items can't merge. Edit the numbers.
                </Trans>
              </p>
            ))}
            {conflictGroups.length === 0 &&
              mergeGroups.map(([number, group]) => (
                <p
                  key={number}
                  className="mt-3 text-pretty text-xs text-muted-foreground"
                >
                  <Trans>
                    {group.indexes.length} operations share batch number{" "}
                    {number} — their output completes as one merged lot.
                  </Trans>
                </p>
              ))}
            <p className="mt-3 text-pretty text-xs text-muted-foreground">
              <Trans>
                Leave an operation at 0 to skip it — it returns to the schedule
                un-run with no time or quantity recorded.
              </Trans>
            </p>
          </ModalBody>
          <ModalFooter>
            <Submit
              size="lg"
              isDisabled={
                allExcluded || missingBatchNumbers || conflictGroups.length > 0
              }
            >
              {/* While the submit is in flight the realtime revalidation sees the
                  batch pass through Completing — don't flip the label mid-run;
                  "Retry" is only true once we are idle and still parked there. */}
              {fetcher.state === "idle" && isCompleting
                ? t`Retry Completion`
                : t`Complete Batch`}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
