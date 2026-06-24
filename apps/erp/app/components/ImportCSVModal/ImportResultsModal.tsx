import {
  Button,
  Count,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tabs,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import Papa from "papaparse";
import { useState } from "react";
import { LuCircleCheck, LuCircleX, LuDownload, LuInfo } from "react-icons/lu";

// A row the importer did not insert/update. `values` holds the original CSV cells
// (keyed by the user's headers) exactly as the server parsed them — so the modal
// renders the real rows without re-parsing the file client-side.
type RowIssue = {
  row: number;
  reason: string;
  values: Record<string, string>;
};

type ImportResultsModalProps = {
  table: string;
  inserted: number;
  updated: number;
  // Rows the user should fix and re-import (validation / missing required data).
  errors: RowIssue[];
  // Rows intentionally not written (duplicates, already-existing) — informational.
  skipped: RowIssue[];
  columns: string[];
  onClose: () => void;
};

type Bucket = "errors" | "skipped";

export const ImportResultsModal = ({
  table,
  inserted,
  updated,
  errors,
  skipped,
  columns,
  onClose
}: ImportResultsModalProps) => {
  const { t } = useLingui();
  const hasErrors = errors.length > 0;
  const hasSkipped = skipped.length > 0;
  const allClean = !hasErrors && !hasSkipped;
  const [bucket, setBucket] = useState<Bucket>(
    hasErrors ? "errors" : "skipped"
  );

  const rows = bucket === "errors" ? errors : skipped;

  // Only the fixable rows go into the "fix and re-import" download — duplicates and
  // already-existing rows aren't something the user re-imports.
  const downloadInvalidRows = () => {
    const data = errors.map((issue) =>
      columns.map((column) => issue.values[column] ?? "")
    );
    const csv = Papa.unparse({ fields: columns, data });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table}-import-errors.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent
        size={allClean ? "medium" : "xxlarge"}
        onInteractOutside={(e) => e.preventDefault()}
        className="min-w-0"
      >
        <ModalHeader>
          <ModalTitle>
            <Trans>Import results</Trans>
          </ModalTitle>
          <ModalDescription>
            {allClean ? (
              <Trans>
                All rows imported — {inserted} inserted, {updated} updated.
              </Trans>
            ) : (
              <Trans>
                {inserted} inserted, {updated} updated, {errors.length} need
                fixing, {skipped.length} skipped.
              </Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="min-w-0">
          {allClean ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <LuCircleCheck className="h-8 w-8 text-emerald-500" />
              <p className="text-sm text-muted-foreground">
                <Trans>Every row was imported successfully.</Trans>
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <Tabs
                  value={bucket}
                  onValueChange={(value) => setBucket(value as Bucket)}
                >
                  <TabsList>
                    <TabsTrigger value="errors" className="gap-1.5">
                      <Trans>Needs fixing</Trans>
                      <Count count={errors.length} />
                    </TabsTrigger>
                    <TabsTrigger value="skipped" className="gap-1.5">
                      <Trans>Skipped</Trans>
                      <Count count={skipped.length} />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {hasErrors && (
                  <Button
                    variant="secondary"
                    size="md"
                    leftIcon={<LuDownload />}
                    onClick={downloadInvalidRows}
                  >
                    <Trans>Download {errors.length} row(s) to fix</Trans>
                  </Button>
                )}
              </div>

              <div className="mt-4 w-full min-w-0 max-h-[420px] overflow-auto rounded-md border border-border">
                <table className="w-max min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr className="border-b border-border text-left text-muted-foreground">
                      {/* Frozen status + reason: stays readable while the (often
                          wide, e.g. BOP) data columns scroll horizontally. */}
                      <th className="sticky left-0 z-30 min-w-[220px] border-r border-border bg-card px-3 py-2 font-medium">
                        <Trans>Reason</Trans>
                      </th>
                      {columns.map((column) => (
                        <th
                          key={column}
                          className="whitespace-nowrap px-3 py-2 font-medium"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.row}
                        className={cn(
                          "border-b border-border last:border-0",
                          bucket === "errors" && "bg-destructive/5"
                        )}
                      >
                        <td className="sticky left-0 z-10 min-w-[220px] max-w-[360px] border-r border-border bg-background px-3 py-2 align-top">
                          <div className="flex items-start gap-2">
                            {bucket === "errors" ? (
                              <LuCircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            ) : (
                              <LuInfo className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span
                              className={cn(
                                bucket === "errors"
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              )}
                            >
                              {row.reason}
                            </span>
                          </div>
                        </td>
                        {columns.map((column) => (
                          <td
                            key={column}
                            className="max-w-48 truncate whitespace-nowrap px-3 py-2 align-top"
                            title={row.values[column]}
                          >
                            {row.values[column]}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={columns.length + 1}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          <Trans>No rows here.</Trans>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>{t`Done`}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
