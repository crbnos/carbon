import {
  formatDate,
  formatQuantity as formatNumericQuantity
} from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import type {
  ChangeNoticeImpactWorkspaceCandidate,
  ChangeNoticeImpactWorkspaceSnapshot
} from "~/modules/items";

type SnapshotFactsProps = {
  candidate: Pick<
    ChangeNoticeImpactWorkspaceCandidate,
    "targetType" | "sourceAvailability" | "currentSnapshot"
  >;
  snapshot?: ChangeNoticeImpactWorkspaceSnapshot | null;
  emptyMessage?: ReactNode;
};

function formatQuantity(
  value: number,
  unit: string | null | undefined,
  locale: string
) {
  const formatted = formatNumericQuantity(value, locale);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatImpactDate(value: string | null | undefined, locale: string) {
  return value ? formatDate(value, undefined, locale) : "—";
}

export function displayJobStatus(status: string | null | undefined) {
  return status === "Ready" ? "Released" : status;
}

export function SnapshotFacts({
  candidate,
  snapshot = candidate.currentSnapshot,
  emptyMessage
}: SnapshotFactsProps) {
  const { locale } = useLocale();
  if (!snapshot) {
    return (
      <span className="text-xs italic text-muted-foreground">
        {emptyMessage ??
          (candidate.sourceAvailability === "Unavailable" ? (
            <Trans>Current source facts are unavailable.</Trans>
          ) : (
            <Trans>
              No current snapshot is needed for this historical reference.
            </Trans>
          ))}
      </span>
    );
  }

  if (
    candidate.targetType === "purchaseOrderLine" &&
    snapshot.schema === "PO_LINE_SNAPSHOT_V1"
  ) {
    return (
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label={<Trans>Ordered</Trans>}
          value={formatQuantity(
            snapshot.orderedQuantity,
            snapshot.purchaseUnitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Received</Trans>}
          value={formatQuantity(
            snapshot.receivedQuantity,
            snapshot.inventoryUnitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Remaining</Trans>}
          value={formatQuantity(
            snapshot.remainingQuantity,
            snapshot.inventoryUnitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Promised</Trans>}
          value={formatImpactDate(snapshot.promisedDate, locale)}
        />
        <Fact
          label={<Trans>Required</Trans>}
          value={formatImpactDate(snapshot.requiredDate, locale)}
        />
        <Fact
          label={<Trans>PO status</Trans>}
          value={snapshot.purchaseOrderStatus}
        />
        <Fact
          label={<Trans>Conversion</Trans>}
          value={`${formatQuantity(snapshot.conversionFactor, null, locale)} ${snapshot.purchaseUnitOfMeasureCode ?? ""} → ${snapshot.inventoryUnitOfMeasureCode ?? ""}`}
        />
        <Fact
          label={<Trans>Receipt complete</Trans>}
          value={
            snapshot.receivedComplete ? <Trans>Yes</Trans> : <Trans>No</Trans>
          }
        />
      </div>
    );
  }

  if (candidate.targetType === "job" && snapshot.schema === "JOB_SNAPSHOT_V1") {
    return (
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label={<Trans>Planned</Trans>}
          value={formatQuantity(
            snapshot.plannedQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Completed</Trans>}
          value={formatQuantity(
            snapshot.completedQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Remaining</Trans>}
          value={formatQuantity(
            snapshot.remainingQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Due</Trans>}
          value={formatImpactDate(snapshot.dueDate, locale)}
        />
        <Fact
          label={<Trans>Job status</Trans>}
          value={displayJobStatus(snapshot.status)}
        />
        <Fact
          label={<Trans>Shipped</Trans>}
          value={formatQuantity(
            snapshot.quantityShipped,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Received to inventory</Trans>}
          value={formatQuantity(
            snapshot.quantityReceivedToInventory,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Method</Trans>}
          value={`V${snapshot.effectiveMethodVersion}`}
        />
      </div>
    );
  }

  if (
    candidate.targetType === "jobMaterial" &&
    snapshot.schema === "JOB_MATERIAL_SNAPSHOT_V1"
  ) {
    return (
      <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label={<Trans>Required</Trans>}
          value={formatQuantity(
            snapshot.requiredQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Issued</Trans>}
          value={
            snapshot.issuedQuantity === null
              ? "—"
              : formatQuantity(
                  snapshot.issuedQuantity,
                  snapshot.unitOfMeasureCode,
                  locale
                )
          }
        />
        <Fact
          label={<Trans>Remaining</Trans>}
          value={formatQuantity(
            snapshot.remainingQuantity,
            snapshot.unitOfMeasureCode,
            locale
          )}
        />
        <Fact
          label={<Trans>Job status</Trans>}
          value={displayJobStatus(snapshot.jobStatus)}
        />
        <Fact label={<Trans>Method type</Trans>} value={snapshot.methodType} />
        <Fact
          label={<Trans>Batch tracking</Trans>}
          value={
            snapshot.requiresTracking.batch ? (
              <Trans>Yes</Trans>
            ) : (
              <Trans>No</Trans>
            )
          }
        />
        <Fact
          label={<Trans>Serial tracking</Trans>}
          value={
            snapshot.requiresTracking.serial ? (
              <Trans>Yes</Trans>
            ) : (
              <Trans>No</Trans>
            )
          }
        />
      </div>
    );
  }

  return (
    <span className="text-xs italic text-muted-foreground">
      <Trans>Current source facts are unavailable.</Trans>
    </span>
  );
}

function Fact({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}
