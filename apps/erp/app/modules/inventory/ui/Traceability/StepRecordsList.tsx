import { Checkbox, cn } from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { LuPaperclip } from "react-icons/lu";
import { Link } from "react-router";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { usePeople } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import type { StepRecord } from "./utils";

type Props = { records: StepRecord[]; jobId?: string | null };

export function StepRecordsList({ records, jobId }: Props) {
  const numberFormatter = useNumberFormatter();
  const unitOfMeasures = useUnitOfMeasure();
  const [employees] = usePeople();

  if (records.length === 0) return null;

  const href = jobId ? path.to.jobOperationStepRecords(jobId) : null;

  return (
    <ul className="divide-y divide-border/30">
      {records.map((r) => {
        const employee = employees.find((e) => e.id === r.createdBy);
        const initials = employee?.name
          ? employee.name
              .split(" ")
              .map((p) => p[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase()
          : null;
        const body = (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <ProcedureStepTypeIcon type={r.type as any} />
              <span className="text-sm truncate flex-1">{r.name}</span>
              <span className="text-sm tabular-nums shrink-0">
                <StepValue
                  record={r}
                  numberFormatter={numberFormatter}
                  unitOfMeasures={unitOfMeasures}
                  employees={employees}
                />
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate flex items-center gap-1.5">
              {r.operationDescription && (
                <span className="truncate">{r.operationDescription}</span>
              )}
              {initials && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="font-medium tracking-wide">{initials}</span>
                </>
              )}
              <span className="text-muted-foreground/40">·</span>
              <span className="tabular-nums">
                {formatDateTime(r.createdAt)}
              </span>
            </div>
          </>
        );
        return (
          <li key={r.id}>
            {href ? (
              <Link
                to={href}
                prefetch="intent"
                className="block px-2 py-1.5 -mx-2 rounded-md hover:bg-accent/50 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {body}
              </Link>
            ) : (
              <div className="py-1.5 first:pt-0 last:pb-0">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type StepValueProps = {
  record: StepRecord;
  numberFormatter: ReturnType<typeof useNumberFormatter>;
  unitOfMeasures: ReturnType<typeof useUnitOfMeasure>;
  employees: ReturnType<typeof usePeople>[0];
};

function StepValue({
  record,
  numberFormatter,
  unitOfMeasures,
  employees
}: StepValueProps) {
  switch (record.type) {
    case "Task":
    case "Checkbox":
      return <Checkbox checked={record.booleanValue ?? false} disabled />;
    case "Value":
    case "List":
      return <span className="font-medium">{record.value ?? "—"}</span>;
    case "Measurement": {
      if (typeof record.numericValue !== "number") return null;
      const unit = unitOfMeasures.find(
        (u) => u.value === record.unitOfMeasureCode
      )?.label;
      const outOfRange =
        (record.minValue !== null &&
          record.minValue !== undefined &&
          record.numericValue < record.minValue) ||
        (record.maxValue !== null &&
          record.maxValue !== undefined &&
          record.numericValue > record.maxValue);
      return (
        <span className={cn("font-medium", outOfRange && "text-red-500")}>
          {numberFormatter.format(record.numericValue)}
          {unit ? (
            <span className="text-muted-foreground ml-1">{unit}</span>
          ) : null}
        </span>
      );
    }
    case "Timestamp":
      return (
        <span className="text-muted-foreground">
          {formatDateTime(record.value ?? "")}
        </span>
      );
    case "Person": {
      const name = employees.find((e) => e.id === record.userValue)?.name;
      return <span className="font-medium">{name ?? "—"}</span>;
    }
    case "File":
      return record.value ? (
        <a
          href={getPrivateUrl(record.value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <LuPaperclip className="size-3" />
          File
        </a>
      ) : null;
    case "Inspection":
      return (
        <span className="inline-flex items-center gap-1.5">
          {record.value && (
            <a
              href={getPrivateUrl(record.value)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <LuPaperclip className="size-3" />
            </a>
          )}
          <Checkbox checked={record.booleanValue ?? false} disabled />
        </span>
      );
    default:
      return null;
  }
}
