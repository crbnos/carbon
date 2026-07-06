import { Hidden, ValidatedForm } from "@carbon/form";
import { Button, Modal, ModalContent, toast } from "@carbon/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useFetcher } from "react-router";
import { z } from "zod";

import { type fieldMappings, importSchemas } from "~/modules/shared";
import type { action } from "~/routes/x+/shared+/import.$tableId";
import { path } from "~/utils/path";
import { AnimatedSizeContainer } from "../AnimatedSizeContainer";
import { FieldMapping } from "./FieldMappings";
import { UploadCSV } from "./UploadCSV";
import { ImportCsvContext } from "./useCsvContext";

enum ImportCSVPage {
  UploadCSV = "upload-csv",
  FieldMappings = "field-mapping"
}

const pages = [ImportCSVPage.UploadCSV, ImportCSVPage.FieldMappings] as const;

type ImportCSVModalProps = {
  table: keyof typeof fieldMappings;
  onClose: () => void;
};

const formId = "import-csv-modal";

export const ImportCSVModal = ({ table, onClose }: ImportCSVModalProps) => {
  const fetcher = useFetcher<typeof action>();

  const [page, setPage] = useState<(typeof pages)[number]>(
    ImportCSVPage.UploadCSV
  );
  const [file, setFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileColumns, setFileColumns] = useState<string[] | null>(null);
  const [firstRows, setFirstRows] = useState<Record<string, string>[] | null>(
    null
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success === true) {
      const inserted = fetcher.data.inserted ?? 0;
      const updated = fetcher.data.updated ?? 0;
      const skipped = fetcher.data.skipped ?? 0;
      if (skipped > 0) {
        // Leave the modal open so the user sees which rows were skipped.
        toast.info(
          `Imported ${inserted}, updated ${updated}, skipped ${skipped} row(s).`
        );
      } else {
        toast.success(`Imported ${inserted}, updated ${updated}.`);
        onClose();
      }
    } else if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success]);

  // if the file upload is successful, set the page to field-mapping
  useEffect(() => {
    if (file && fileColumns && page === ImportCSVPage.UploadCSV) {
      setPage(ImportCSVPage.FieldMappings);
    }
  }, [file, fileColumns, page]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent onInteractOutside={(e) => e.preventDefault()}>
        <div className="relative">
          <AnimatedSizeContainer height>
            <ImportCsvContext.Provider
              value={{
                file,
                fileColumns,
                firstRows,
                filePath,
                setFile,
                setFileColumns,
                setFirstRows,
                setFilePath
              }}
            >
              <div>
                <ValidatedForm
                  className="flex flex-col gap-y-4"
                  fetcher={fetcher}
                  method="post"
                  action={path.to.import(table)}
                  validator={importSchemas[table].extend({
                    filePath: z
                      .string()
                      .min(1, { message: "Path is required" }),
                    enumMappings: z.string().optional()
                  })}
                  id={formId}
                  onSubmit={() => {
                    toast.info("Importing...");
                  }}
                >
                  <Hidden name="filePath" value={filePath ?? ""} />
                  {page === ImportCSVPage.UploadCSV && (
                    <UploadCSV table={table} />
                  )}
                  {page === ImportCSVPage.FieldMappings && (
                    <FieldMapping
                      formId={formId}
                      table={table}
                      onReset={() => {
                        flushSync(() => {
                          setFile(null);
                          setFileColumns(null);
                          setFirstRows(null);
                        });
                        setPage(ImportCSVPage.UploadCSV);
                      }}
                    />
                  )}
                </ValidatedForm>
                {fetcher.data?.success === true &&
                  (fetcher.data.skipped ?? 0) > 0 && (
                    <div className="mt-4 rounded-md border border-border p-3">
                      <p className="text-sm font-medium">
                        {fetcher.data.skipped} row(s) were skipped:
                      </p>
                      <ul className="mt-2 max-h-48 overflow-auto text-sm text-muted-foreground">
                        {(fetcher.data.errors ?? []).map(
                          (e: { row: number; reason: string }) => (
                            <li key={e.row}>
                              Row {e.row + 1}: {e.reason}
                            </li>
                          )
                        )}
                      </ul>
                      <Button
                        className="mt-3"
                        variant="secondary"
                        onClick={onClose}
                      >
                        Done
                      </Button>
                    </div>
                  )}
              </div>
            </ImportCsvContext.Provider>
          </AnimatedSizeContainer>
        </div>
      </ModalContent>
    </Modal>
  );
};
