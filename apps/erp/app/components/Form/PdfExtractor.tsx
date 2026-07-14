import { getLogger } from "@carbon/logger";
import { Spinner, useCarbon } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { FileDropzone } from "~/components";
import { useUser } from "~/hooks";
import { useDocumentExtraction } from "~/hooks/useDocumentExtraction";
import type { ExtractedDocumentData } from "~/modules/documents";

const logger = getLogger("erp", "pdfextractor");

type PdfExtractorProps = {
  documentType: "purchaseInvoice" | "salesRfq";
  sourceDocument: string;
  sourceDocumentId?: string;
  /** Heading shown above the drop zone (e.g. "Invoice", "RFQ"). */
  label: string;
  onExtractionComplete: (data: ExtractedDocumentData) => void;
};

export function PdfExtractor({
  documentType,
  sourceDocument,
  sourceDocumentId,
  label,
  onExtractionComplete
}: PdfExtractorProps) {
  const { t } = useLingui();
  const { carbon: supabase } = useCarbon();
  const { company } = useUser();
  const fetcher = useFetcher<{ extractionId?: string }>();
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notifiedExtractionId, setNotifiedExtractionId] = useState<
    string | null
  >(null);

  const { extraction } = useDocumentExtraction(extractionId, documentType);

  // Adopt each newly-created extraction id (a re-upload returns a fresh one).
  // Keying on the id — not `!extractionId` — avoids re-latching the prior id
  // while `fetcher.data` still holds it during a resubmission.
  const latestExtractionId = fetcher.data?.extractionId;
  useEffect(() => {
    if (latestExtractionId) {
      setExtractionId(latestExtractionId);
      setNotifiedExtractionId(null);
    }
  }, [latestExtractionId]);

  // When extraction completes, notify parent
  useEffect(() => {
    if (
      extraction?.status === "completed" &&
      extraction.filteredData &&
      extractionId !== notifiedExtractionId
    ) {
      setNotifiedExtractionId(extractionId);
      onExtractionComplete({
        ...extraction.filteredData,
        _storagePath: extraction.storagePath
      });
    }
  }, [
    extraction?.status,
    extraction?.filteredData,
    extraction?.storagePath,
    onExtractionComplete,
    extractionId,
    notifiedExtractionId
  ]);

  const handleDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !file.name.endsWith(".pdf")) return;
    if (!supabase) return;

    setUploading(true);
    const storagePath = `${company.id}/extractions/${Date.now()}_${file.name}`;

    const { error } = await supabase.storage
      .from("private")
      .upload(storagePath, file);

    if (error) {
      logger.error("Upload failed", error);
      setUploading(false);
      return;
    }

    // Trigger extraction via API
    const formData = new FormData();
    formData.append("storagePath", storagePath);
    formData.append("documentType", documentType);
    formData.append("sourceDocument", sourceDocument);
    if (sourceDocumentId) formData.append("sourceDocumentId", sourceDocumentId);

    fetcher.submit(formData, {
      method: "post",
      action: "/api/document-extraction"
    });

    setUploading(false);
  };

  const status = extraction?.status;
  const isExtracting =
    extractionId !== null && status !== "completed" && status !== "failed";
  const isBusy = uploading || fetcher.state !== "idle" || isExtracting;

  return (
    <div className="mt-6 flex flex-col gap-2">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <FileDropzone
          onDrop={handleDrop}
          accept={{ "application/pdf": [".pdf"] }}
          multiple={false}
          disabled={isBusy}
          className="mt-0"
        />
        {isBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-background/70 backdrop-blur-sm">
            <Spinner className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {uploading ? t`Uploading...` : t`Reading the document...`}
            </p>
            <p className="text-xs text-muted-foreground">
              {t`This may take a moment. Hang tight.`}
            </p>
          </div>
        )}
      </div>
      {status === "failed" && (
        <p className="text-xs text-red-600">
          {t`Could not read the document: ${extraction?.error ?? ""}`}
        </p>
      )}
    </div>
  );
}
