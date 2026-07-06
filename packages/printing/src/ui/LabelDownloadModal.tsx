import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import type { LabelSize } from "@carbon/utils";
import { getLabelSizeLabel, labelSizes } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuDownload, LuInfo } from "react-icons/lu";
import { Link } from "react-router";
import { usePrinting } from "./PrintingProvider";

type FileRoutes = {
  pdf: (id: string, opts?: { labelSize?: string }) => string;
  zpl: (id: string, opts?: { labelSize?: string }) => string;
};

export function LabelDownloadModal({
  sourceDocumentId,
  fileRoutes,
  isOpen,
  onClose
}: {
  sourceDocumentId: string;
  fileRoutes: FileRoutes;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { useMetric, settingsPath, settingsExternal } = usePrinting();

  if (!isOpen) return null;

  const openFile = (url: string) => {
    window.open(window.location.origin + url, "_blank");
    onClose();
  };

  const renderSizes = (sizes: LabelSize[]) => (
    <div className="flex flex-col gap-1">
      {sizes
        .filter((s) => s.zpl)
        .map((size) => (
          <button
            type="button"
            key={`zpl-${size.id}`}
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted transition-colors text-left"
            onClick={() =>
              openFile(fileRoutes.zpl(sourceDocumentId, { labelSize: size.id }))
            }
          >
            <LuDownload className="size-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">
                {getLabelSizeLabel(size)}
              </span>
            </div>
            <Badge variant="green">ZPL</Badge>
          </button>
        ))}
      {sizes.map((size) => (
        <button
          type="button"
          key={`pdf-${size.id}`}
          className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted transition-colors text-left"
          onClick={() =>
            openFile(fileRoutes.pdf(sourceDocumentId, { labelSize: size.id }))
          }
        >
          <LuDownload className="size-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">
              {getLabelSizeLabel(size)}
            </span>
          </div>
          <Badge variant="blue">PDF</Badge>
        </button>
      ))}
    </div>
  );

  const metricSizes = labelSizes.filter((s) => s.metric);
  const imperialSizes = labelSizes.filter((s) => !s.metric);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Download Labels</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4 pb-4">
            <Alert variant="info">
              <LuInfo className="size-4" />
              <AlertTitle>
                <Trans>No printer configured</Trans>
              </AlertTitle>
              <AlertDescription>
                <div className="flex items-center justify-between gap-4">
                  <span>
                    <Trans>
                      Add a printer in the printing settings to print labels
                      directly.
                    </Trans>
                  </span>
                  <Button variant="secondary" size="sm" asChild>
                    {settingsExternal ? (
                      <a href={settingsPath} target="_blank" rel="noreferrer">
                        <Trans>Printer Settings</Trans>
                      </a>
                    ) : (
                      <Link to={settingsPath}>
                        <Trans>Printer Settings</Trans>
                      </Link>
                    )}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
            <Tabs defaultValue={useMetric ? "metric" : "imperial"}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="imperial">
                  <Trans>Imperial</Trans>
                </TabsTrigger>
                <TabsTrigger value="metric">
                  <Trans>Metric</Trans>
                </TabsTrigger>
              </TabsList>
              <TabsContent className="mt-2" value="imperial">
                {renderSizes(imperialSizes)}
              </TabsContent>
              <TabsContent className="mt-2" value="metric">
                {renderSizes(metricSizes)}
              </TabsContent>
            </Tabs>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
