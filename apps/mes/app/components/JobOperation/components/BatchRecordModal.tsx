import { useCarbon } from "@carbon/auth";
import {
  Button,
  Checkbox,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Switch,
  toast
} from "@carbon/react";
import {
  datetime,
  getCompanyPrivateBucket,
  stripSpecialCharacters
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { LuCircleCheck, LuFile } from "react-icons/lu";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks";
import type { BatchStep } from "~/services/operations.service";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import FileDropzone from "../../FileDropzone";

// How a step type is captured in the grid: a typed cell per job (values differ
// part to part), or a tick per job with one shared payload (a task done, a
// timestamp, one photo for every job).
type Kind = "number" | "text" | "list" | "person" | "tick" | "file";

const kindOf = (type: string): Kind =>
  type === "Measurement"
    ? "number"
    : type === "Value"
      ? "text"
      : type === "List"
        ? "list"
        : type === "Person"
          ? "person"
          : type === "File" || type === "Inspection"
            ? "file"
            : "tick";

type Member = BatchStep["perMember"][number];

const initialValue = (kind: Kind, member: Member) => {
  const record = member.record;
  if (!record) return "";
  if (kind === "number") return record.numericValue?.toString() ?? "";
  if (kind === "person") return record.userValue ?? "";
  return record.value ?? "";
};

// Same bare, full-cell input as the Complete Batch grid.
const cellClass =
  "block h-full min-h-12 w-full bg-transparent px-3 text-base outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

// Records one work-instruction step for every job in the batch from a single
// grid — the batch view's counterpart of the per-job RecordModal. Only rows
// that are new or changed are sent (a re-record re-runs the step's backflush).
export function BatchRecordModal({
  batchId,
  step,
  members,
  jobIdOf,
  onClose
}: {
  batchId: string;
  step: BatchStep;
  // The step's per-member rows, already in job order.
  members: Member[];
  jobIdOf: (jobOperationId: string) => string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [people] = usePeople();
  const fetcher = useFetcher<{ success?: boolean }>();
  const kind = kindOf(step.type);
  const ticked = kind === "tick" || kind === "file";

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => [m.stepId, initialValue(kind, m)]))
  );
  // Tick kinds: the jobs to record. Recorded ones stay recorded (untick them
  // in the job's own view), so the default is "everything still open".
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(members.filter((m) => !m.recorded).map((m) => m.stepId))
  );
  const [file, setFile] = useState<File | null>(null);
  const [passed, setPassed] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (fetcher.data?.success) onClose();
  }, [fetcher.data?.success, onClose]);

  const changed = members.filter((m) =>
    ticked
      ? selected.has(m.stepId)
      : values[m.stepId]?.trim() &&
        values[m.stepId] !== initialValue(kind, m) &&
        (kind !== "number" || Number.isFinite(Number(values[m.stepId])))
  );
  const open = members.filter((m) => !m.recorded);
  const busy = uploading || fetcher.state !== "idle";

  const outOfRange = (value: string) => {
    if (kind !== "number" || !value.trim()) return false;
    const n = Number(value);
    return (
      (step.minValue !== null && n < step.minValue) ||
      (step.maxValue !== null && n > step.maxValue)
    );
  };

  const setAll = (value: string) =>
    setValues(Object.fromEntries(members.map((m) => [m.stepId, value])));

  const submit = async () => {
    const formData = new FormData();
    let paths: string[] = [];
    if (kind === "file" && file && carbon) {
      // One upload per job, under each job's own step folder — the path shape
      // is the contract the customer-portal file route authorizes against.
      setUploading(true);
      const safeName = stripSpecialCharacters(file.name) || "file";
      const uploads = await Promise.all(
        changed.map((m) =>
          carbon.storage
            .from(getCompanyPrivateBucket(company.id))
            .upload(
              `${company.id}/job/${m.jobOperationId}/${m.stepId}/${nanoid()}/${safeName}`,
              file,
              { cacheControl: `${12 * 60 * 60}`, upsert: true }
            )
        )
      );
      setUploading(false);
      if (uploads.some((u) => u.error || !u.data?.path)) {
        toast.error(t`Failed to upload ${file.name}`);
        return;
      }
      paths = uploads.map((u) => u.data?.path ?? "");
    }

    const now = datetime.timestamp();
    changed.forEach((m, i) => {
      const prefix = `records[${i}]`;
      formData.append(`${prefix}.jobOperationStepId`, m.stepId);
      const value = values[m.stepId] ?? "";
      if (kind === "number") formData.append(`${prefix}.numericValue`, value);
      else if (kind === "text" || kind === "list")
        formData.append(`${prefix}.value`, value);
      else if (kind === "person") formData.append(`${prefix}.userValue`, value);
      else if (kind === "file") {
        formData.append(`${prefix}.value`, paths[i] ?? "");
        if (step.type === "Inspection")
          formData.append(`${prefix}.booleanValue`, String(passed));
      } else if (step.type === "Timestamp")
        formData.append(`${prefix}.value`, now);
      else formData.append(`${prefix}.booleanValue`, "true");
    });
    fetcher.submit(formData, {
      method: "post",
      action: path.to.batchRecord(batchId)
    });
  };

  const cellFor = (m: Member | null) => {
    // `null` is the "All jobs" row: it writes every job's cell.
    const rowValues = members.map((row) => values[row.stepId] ?? "");
    const value = m
      ? (values[m.stepId] ?? "")
      : rowValues.every((v) => v === rowValues[0])
        ? (rowValues[0] ?? "")
        : "";
    const onChange = (v: string) =>
      m ? setValues((prev) => ({ ...prev, [m.stepId]: v })) : setAll(v);

    if (kind === "number" || kind === "text") {
      return (
        <input
          type="text"
          inputMode={kind === "number" ? "decimal" : "text"}
          aria-label={m ? jobIdOf(m.jobOperationId) : t`All jobs`}
          placeholder={m ? undefined : t`Same for every job`}
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) =>
            onChange(
              kind === "number"
                ? e.target.value.replace(/[^0-9.-]/g, "")
                : e.target.value
            )
          }
          className={cn(
            cellClass,
            kind === "number" && "text-right font-mono tabular-nums",
            outOfRange(value) && "bg-red-500/10 text-red-600"
          )}
        />
      );
    }
    if (kind === "list" || kind === "person") {
      const options =
        kind === "list"
          ? (step.listValues ?? []).map((v) => ({ value: v, label: v }))
          : people.map((p) => ({ value: p.id, label: p.name }));
      return (
        <select
          aria-label={m ? jobIdOf(m.jobOperationId) : t`All jobs`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(cellClass, !value && "text-muted-foreground")}
        >
          <option value="">{m ? "—" : t`Same for every job`}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    // Tick kinds
    const recorded = m?.recorded ?? false;
    const checked = m
      ? recorded || selected.has(m.stepId)
      : open.length > 0 && open.every((o) => selected.has(o.stepId));
    return (
      <div className="flex min-h-12 items-center justify-center">
        <Checkbox
          aria-label={m ? jobIdOf(m.jobOperationId) : t`All jobs`}
          checked={checked}
          disabled={recorded || (!m && open.length === 0)}
          onCheckedChange={(next) =>
            setSelected((prev) => {
              const targets = m ? [m] : open;
              const copy = new Set(prev);
              for (const target of targets) {
                if (next) copy.add(target.stepId);
                else copy.delete(target.stepId);
              }
              return copy;
            })
          }
        />
      </div>
    );
  };

  const spec =
    step.minValue !== null && step.maxValue !== null
      ? t`Between ${step.minValue} and ${step.maxValue} ${step.unitOfMeasureCode ?? ""}`
      : null;

  return (
    <Modal
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <ModalTitle>{step.name}</ModalTitle>
          <ModalDescription>
            {spec ??
              (ticked ? (
                <Trans>Tick the jobs this was done for.</Trans>
              ) : (
                <Trans>
                  Enter each job's value, or fill every job at once from the
                  first row. Empty rows are skipped.
                </Trans>
              ))}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {kind === "file" && (
            <div className="mb-4 flex flex-col gap-3">
              {file ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <LuFile className="size-5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{file.name}</span>
                  </div>
                  <Button variant="secondary" onClick={() => setFile(null)}>
                    <Trans>Remove</Trans>
                  </Button>
                </div>
              ) : (
                <FileDropzone onDrop={(files) => setFile(files[0] ?? null)} />
              )}
              {step.type === "Inspection" && (
                <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
                  <span className="text-sm font-medium">
                    <Trans>Passed inspection</Trans>
                  </span>
                  <Switch checked={passed} onCheckedChange={setPassed} />
                </div>
              )}
            </div>
          )}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="border-b border-r bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground">
                    <Trans>Job</Trans>
                  </th>
                  <th
                    className={cn(
                      "border-b bg-muted/40 px-3 py-2 font-medium text-muted-foreground",
                      ticked ? "w-24 text-center" : "text-left",
                      kind === "number" && "text-right"
                    )}
                  >
                    {ticked ? (
                      <Trans>Done</Trans>
                    ) : kind === "number" && step.unitOfMeasureCode ? (
                      step.unitOfMeasureCode
                    ) : (
                      <Trans>Value</Trans>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.length > 1 && (
                  <tr className="bg-muted/20">
                    <td className="border-b border-r px-3 py-2 align-middle font-medium text-muted-foreground">
                      <Trans>All jobs</Trans>
                    </td>
                    <td className="border-b p-0 align-middle">
                      {cellFor(null)}
                    </td>
                  </tr>
                )}
                {members.map((m, i) => {
                  const isLast = i === members.length - 1;
                  return (
                    <tr key={m.stepId}>
                      <td
                        className={cn(
                          "border-r px-3 py-2 align-middle",
                          !isLast && "border-b"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium tabular-nums">
                            {jobIdOf(m.jobOperationId)}
                          </span>
                          {m.recorded && (
                            <LuCircleCheck
                              className="size-4 text-emerald-500"
                              aria-label={t`Recorded`}
                            />
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "p-0 align-middle",
                          !isLast && "border-b"
                        )}
                      >
                        {cellFor(m)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="lg" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            size="lg"
            rightIcon={<LuCircleCheck />}
            isLoading={busy}
            isDisabled={
              busy || changed.length === 0 || (kind === "file" && !file)
            }
            onClick={submit}
          >
            {changed.length > 0 ? (
              <Trans>Record {changed.length} jobs</Trans>
            ) : (
              <Trans>Record</Trans>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
