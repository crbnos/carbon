import { Trans } from "@lingui/react/macro";
import SharedMapExtractedLinesModal from "~/components/MapExtractedLinesModal";

export type MapExtractedInvoiceLinesModalProps = {
  invoiceId: string;
  supplierId: string | undefined;
  onClose: () => void;
};

export default function MapExtractedInvoiceLinesModal({
  invoiceId,
  supplierId,
  onClose
}: MapExtractedInvoiceLinesModalProps) {
  return (
    <SharedMapExtractedLinesModal
      endpoint={`/api/purchase-invoice/${invoiceId}/map-lines`}
      party={{ field: "supplierId", id: supplierId }}
      title={<Trans>Map Extracted Invoice Lines</Trans>}
      onClose={onClose}
      renderSummary={(map) => (
        <>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {map.description || <Trans>Untitled line</Trans>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {map.quantity != null && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                <Trans>Qty</Trans> {map.quantity}
              </span>
            )}
            {map.unitPrice != null && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {map.unitPrice}
              </span>
            )}
          </div>
        </>
      )}
    />
  );
}
