import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  useDisclosure
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuCheck, LuPrinter } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { PrinterContext } from "../assignments";
import { LabelDownloadModal } from "./LabelDownloadModal";
import { usePrinting } from "./PrintingProvider";

type FileRoutes = {
  pdf: (id: string, opts?: { labelSize?: string }) => string;
  zpl: (id: string, opts?: { labelSize?: string }) => string;
};

export function PrintButton({
  sourceDocument,
  sourceDocumentId,
  locationId,
  context,
  workCenterId,
  fileRoutes,
  disabled
}: {
  sourceDocument: string;
  sourceDocumentId: string;
  locationId: string | undefined;
  context: PrinterContext;
  workCenterId?: string;
  fileRoutes: FileRoutes;
  disabled?: boolean;
}) {
  const { printerRoutes, resolvePrinterRoute, printPath } = usePrinting();
  const modal = useDisclosure();
  const downloadModal = useDisclosure();
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  const defaultPrinter = resolvePrinterRoute(locationId, context, workCenterId);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>(
    defaultPrinter?.id ?? ""
  );

  useEffect(() => {
    if (modal.isOpen) {
      setSelectedPrinterId(defaultPrinter?.id ?? printerRoutes[0]?.id ?? "");
    }
  }, [modal.isOpen, defaultPrinter?.id, printerRoutes]);

  useEffect(() => {
    if (fetcher.data?.success) {
      toast.success(fetcher.data.message);
      modal.onClose();
    } else if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data, modal.onClose]);

  const handleClick = () => {
    if (printerRoutes.length > 0) {
      modal.onOpen();
    } else {
      downloadModal.onOpen();
    }
  };

  const handlePrint = () => {
    fetcher.submit(
      {
        sourceDocument,
        sourceDocumentId,
        ...(locationId ? { locationId } : {}),
        ...(workCenterId ? { workCenterId } : {}),
        printerRouteId: selectedPrinterId
      },
      {
        method: "POST",
        action: printPath,
        encType: "application/json"
      }
    );
  };

  return (
    <>
      <Button
        leftIcon={<LuPrinter />}
        variant="secondary"
        disabled={disabled}
        onClick={handleClick}
      >
        <Trans>Print</Trans>
      </Button>

      {modal.isOpen && (
        <Modal open onOpenChange={(open) => !open && modal.onClose()}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Select Printer</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-1">
                {printerRoutes.map((route) => (
                  <button
                    type="button"
                    key={route.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selectedPrinterId === route.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => setSelectedPrinterId(route.id)}
                  >
                    <LuPrinter className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{route.name}</span>
                      <span className="text-xs text-muted-foreground ml-2 uppercase">
                        {route.format}
                      </span>
                      {route.mediaSizeId && (
                        <span className="text-xs text-muted-foreground ml-2">
                          {route.mediaSizeId}
                        </span>
                      )}
                    </div>
                    {selectedPrinterId === route.id && (
                      <LuCheck className="size-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </ModalBody>
            <ModalFooter>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  leftIcon={<LuPrinter />}
                  disabled={!selectedPrinterId || fetcher.state !== "idle"}
                  onClick={handlePrint}
                >
                  <Trans>Print</Trans>
                </Button>
                <Button variant="solid" onClick={modal.onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </div>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      <LabelDownloadModal
        sourceDocumentId={sourceDocumentId}
        fileRoutes={fileRoutes}
        isOpen={downloadModal.isOpen}
        onClose={downloadModal.onClose}
      />
    </>
  );
}
