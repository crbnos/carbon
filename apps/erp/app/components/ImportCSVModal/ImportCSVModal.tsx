// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Hidden, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import { Modal, ModalContent, toast } from "@carbon/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import {
  type fieldMappings,
  importSchemas
} from "~/modules/shared/imports.models";
import type { MethodRowsAdded } from "~/modules/shared/types";
import type { action } from "~/routes/x+/shared+/import.$tableId";
import { path } from "~/utils/path";
import { AnimatedSizeContainer } from "../AnimatedSizeContainer";
import { ConfirmDiscardImport } from "./ConfirmDiscardImport";
import { FieldMapping } from "./FieldMappings";
import { ImportResultsModal } from "./ImportResultsModal";
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
  // A failed import is toasted by `useAction`.
  const fetcher = useAction<typeof action>({
    onSuccess: (result) => {
      if (!("data" in result) || !result.data) return;
      const { inserted, updated, errors, skipped, added, warnings } =
        result.data;
      // The results modal renders next (see the early return below); just
      // surface a quick toast summary here.
      if (added) {
        const message = methodImportMessage({
          inserted,
          updated,
          errors: errors.length,
          skipped: skipped.length,
          added
        });
        if (errors.length > 0 || skipped.length > 0 || warnings.length > 0) {
          toast.info(message);
        } else {
          toast.success(message);
        }
      } else if (errors.length > 0) {
        toast.info(
          `Imported ${inserted}, updated ${updated} — ${errors.length} row(s) need fixing.`
        );
      } else if (skipped.length > 0) {
        toast.info(
          `Imported ${inserted}, updated ${updated}, skipped ${skipped.length} row(s).`
        );
      } else {
        toast.success(`Imported ${inserted}, updated ${updated}.`);
      }
    }
  });
  const imported =
    fetcher.data && "data" in fetcher.data ? fetcher.data.data : null;

  const [page, setPage] = useState<(typeof pages)[number]>(
    ImportCSVPage.UploadCSV
  );
  const [file, setFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileColumns, setFileColumns] = useState<string[] | null>(null);
  const [firstRows, setFirstRows] = useState<Record<string, string>[] | null>(
    null
  );
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  // Parsed columns are what moves the wizard off the upload step, so they are
  // also the point from which closing costs the user something: the upload and
  // every mapping they've made, all of which the wizard keeps in memory and
  // nowhere else. Before that (and after "choose a different file", which
  // clears them) the × closes straight away. Once the import has landed the
  // results modal owns the close and there is nothing left to lose.
  const hasImportInProgress = fileColumns !== null && !imported;

  const requestClose = () => {
    if (hasImportInProgress) {
      setIsConfirmingDiscard(true);
      return;
    }
    onClose();
  };

  // A reload drops the same state, and there is nowhere to persist it to yet,
  // so the browser's own prompt is the only guard available for that path.
  useEffect(() => {
    if (!hasImportInProgress) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasImportInProgress]);

  // if the file upload is successful, set the page to field-mapping
  useEffect(() => {
    if (file && fileColumns && page === ImportCSVPage.UploadCSV) {
      setPage(ImportCSVPage.FieldMappings);
    }
  }, [file, fileColumns, page]);

  // After a successful import, swap the wizard for the bigger results modal:
  // every parsed row marked valid/error, filterable, with an errors-only CSV
  // download (firstRows holds the full file, so no re-parse needed).
  if (imported && fileColumns) {
    return (
      <ImportResultsModal
        table={table}
        inserted={imported.inserted}
        updated={imported.updated}
        errors={imported.errors}
        skipped={imported.skipped}
        added={imported.added}
        warnings={imported.warnings}
        columns={fileColumns}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
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
              </div>
            </ImportCsvContext.Provider>
          </AnimatedSizeContainer>
        </div>
      </ModalContent>
      {isConfirmingDiscard && (
        <ConfirmDiscardImport
          onCancel={() => setIsConfirmingDiscard(false)}
          onDiscard={onClose}
        />
      )}
    </Modal>
  );
};

// Method imports: inserted and updated count parts, the rest count rows. The
// same sentences as the results dialog's MethodImportCounts.
function methodImportMessage(counts: {
  inserted: number;
  updated: number;
  errors: number;
  skipped: number;
  added: MethodRowsAdded;
}) {
  const { added } = counts;
  const count = (n: number, one: string, other: string) =>
    `${n} ${n === 1 ? one : other}`;
  const parts = [
    counts.inserted > 0 &&
      count(counts.inserted, "part created", "parts created"),
    counts.updated > 0 && count(counts.updated, "part updated", "parts updated")
  ].filter(Boolean);
  const rows = [
    added.materials > 0 && count(added.materials, "BOM line", "BOM lines"),
    added.operations > 0 && count(added.operations, "operation", "operations"),
    added.steps > 0 && count(added.steps, "step", "steps"),
    added.tools > 0 && count(added.tools, "tool", "tools"),
    added.parameters > 0 && count(added.parameters, "parameter", "parameters")
  ].filter(Boolean);
  return [
    parts.length > 0 ? `${parts.join(", ")}.` : "No parts changed.",
    rows.length > 0 && `Added: ${rows.join(", ")}.`,
    (counts.errors > 0 || counts.skipped > 0) &&
      `${count(counts.errors, "row needs fixing", "rows need fixing")}, ${count(counts.skipped, "row skipped", "rows skipped")}.`
  ]
    .filter(Boolean)
    .join(" ");
}
