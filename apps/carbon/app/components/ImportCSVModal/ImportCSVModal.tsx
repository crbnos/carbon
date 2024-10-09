import { Hidden, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import {
  importSchemas,
  type fieldMappings,
} from "~/modules/shared/imports.models";
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

export const ImportCSVModal = ({ table, onClose }: ImportCSVModalProps) => {
  const fetcher = useFetcher<{}>();

  const [page, setPage] = useState<(typeof pages)[number]>(
    ImportCSVPage.UploadCSV
  );
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [fileColumns, setFileColumns] = useState<string[] | null>(null);
  const [firstRows, setFirstRows] = useState<Record<string, string>[] | null>(
    null
  );

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
          <ModalHeader>
            <div className="flex space-x-4 items-center mb-4">
              <ModalTitle className="m-0 p-0">
                {page === ImportCSVPage.UploadCSV && "Upload CSV"}
                {page === ImportCSVPage.FieldMappings && "Field mapping"}
              </ModalTitle>
            </div>
            <ModalDescription>
              {page === ImportCSVPage.UploadCSV &&
                `Please upload a CSV file of your ${table} data`}
              {page === ImportCSVPage.FieldMappings &&
                "We've mapped each column to what we believe is correct, but please review the data below to confirm it's accurate."}
            </ModalDescription>
          </ModalHeader>

          <div className="relative">
            <AnimatedSizeContainer height>
              <ImportCsvContext.Provider
                value={{
                  file,
                  fileColumns,
                  firstRows,
                  path,
                  setFile,
                  setFileColumns,
                  setFirstRows,
                  setPath,
                }}
              >
                <div>
                  <ValidatedForm
                    className="flex flex-col gap-y-4"
                    fetcher={fetcher}
                    validator={importSchemas[table].extend({
                      path: z.string().min(1, { message: "Path is required" }),
                    })}
                  >
                    <Hidden name="path" value={path ?? ""} />
                    {page === ImportCSVPage.UploadCSV && <UploadCSV />}
                    {page === ImportCSVPage.FieldMappings && (
                      <>
                        <FieldMapping table={table} />

                        <Submit
                          isDisabled={!path || fetcher.state !== "idle"}
                          className="mt-4"
                          type="submit"
                        >
                          Confirm Import
                        </Submit>

                        <Button
                          variant="link"
                          type="button"
                          onClick={() => {
                            flushSync(() => {
                              setFile(null);
                              setFileColumns(null);
                              setFirstRows(null);
                            });
                            setPage(ImportCSVPage.UploadCSV);
                          }}
                        >
                          Choose another file
                        </Button>
                      </>
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
