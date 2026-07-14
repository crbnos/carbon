import { Trans } from "@lingui/react/macro";
import SharedMapExtractedLinesModal from "~/components/MapExtractedLinesModal";
import { path } from "~/utils/path";

export type MapExtractedLinesModalProps = {
  rfqId: string;
  customerId: string | undefined;
  onClose: () => void;
};

export default function MapExtractedLinesModal({
  rfqId,
  customerId,
  onClose
}: MapExtractedLinesModalProps) {
  return (
    <SharedMapExtractedLinesModal
      endpoint={`${path.to.api.salesRfq(rfqId)}/map-lines`}
      party={{ field: "customerId", id: customerId }}
      title={<Trans>Map Extracted Lines</Trans>}
      onClose={onClose}
      renderSummary={(map) => (
        <>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium text-foreground">
              {map.customerPartId}
            </p>
            {map.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {map.description}
              </p>
            )}
          </div>
          {map.quantity?.[0] != null && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
              <Trans>Qty</Trans> {map.quantity?.[0]}
            </span>
          )}
        </>
      )}
    />
  );
}
