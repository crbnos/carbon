import { Hidden, ValidatedForm } from "@carbon/form";
import { Modal, ModalContent, toast } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import {
  importSchemas,
  type fieldMappings,
} from "~/modules/shared/imports.models";
import type { action } from "~/routes/x+/shared+/import.$tableId";
import { path } from "~/utils/path";
import { AnimatedSizeContainer } from "../AnimatedSizeContainer";
import { FieldMapping } from "./FieldMappings";
import { UploadCSV } from "./UploadCSV";
import { ImportCsvContext } from "./useCsvContext";

enum ImportCSVPage {
  UploadCSV = "upload-csv",
  FieldMappings = "field-mapping",
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

  useEffect(() => {
    if (fetcher.data?.success === true) {
      toast.success("Import successful.");
      onClose();
    } else if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <ModalContent>
        <div className="p-4">
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
                  setFilePath,
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
                      enumMappings: z.string().optional(),
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
                </div>
              </ImportCsvContext.Provider>
            </AnimatedSizeContainer>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
};
