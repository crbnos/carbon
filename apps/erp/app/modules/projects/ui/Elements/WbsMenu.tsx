// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseCsvFile } from "@carbon/files/csv";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuChartGantt,
  LuEllipsisVertical,
  LuFileSpreadsheet,
  LuFileUp,
  LuPin
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Confirm } from "~/components/Modals";
import { path } from "~/utils/path";
import type { WbsCsvResult } from "../../projects.models";

type ImportResponse = {
  success: boolean;
  applied?: boolean;
  result?: WbsCsvResult;
  message?: string;
};

/**
 * The Plan page's ⋯ menu for the project's WBS: export as CSV or as
 * Microsoft Project XML, import a CSV, and pin every derived code.
 */
export function WbsMenu({
  projectId,
  canUpdate
}: {
  projectId: string;
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const [importing, setImporting] = useState(false);
  const [pinning, setPinning] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`WBS options`}
            icon={<LuEllipsisVertical />}
            variant="secondary"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem asChild>
            <a href={path.to.api.projectWbsCsv(projectId)} download>
              <DropdownMenuIcon icon={<LuFileSpreadsheet />} />
              <Trans>Export CSV</Trans>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={path.to.api.projectMspdi(projectId)} download>
              <DropdownMenuIcon icon={<LuChartGantt />} />
              <Trans>Export MS Project XML</Trans>
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canUpdate}
            onClick={() => setImporting(true)}
          >
            <DropdownMenuIcon icon={<LuFileUp />} />
            <Trans>Import CSV</Trans>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canUpdate}
            onClick={() => setPinning(true)}
          >
            <DropdownMenuIcon icon={<LuPin />} />
            <Trans>Pin WBS codes</Trans>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {importing && (
        <ImportWbsModal
          projectId={projectId}
          onClose={() => setImporting(false)}
        />
      )}
      {pinning && (
        <Confirm
          action={path.to.projectWbsPin(projectId)}
          title={t`Pin WBS codes`}
          text={t`Every element keeps its current WBS code, even when it moves. Do this when the codes match the contract WBS.`}
          confirmText={t`Pin`}
          onCancel={() => setPinning(false)}
          onSubmit={() => setPinning(false)}
        />
      )}
    </>
  );
}

/**
 * Upload a WBS CSV, see what it will do, then apply it. The file is parsed
 * in the browser and posted as rows; the action reads them with
 * `readWbsCsv`, so the preview and the apply agree.
 */
function ImportWbsModal({
  projectId,
  onClose
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<ImportResponse>();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const response = fetcher.data;
  const result = response?.result;
  useEffect(() => {
    if (fetcher.state === "idle" && response?.applied) onClose();
  }, [fetcher.state, response?.applied, onClose]);

  const submit = (intent: "preview" | "apply", data = rows) => {
    if (!data) return;
    fetcher.submit(
      { intent, rows: JSON.stringify(data) },
      { method: "post", action: path.to.projectWbsImport(projectId) }
    );
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError(null);
    try {
      const parsed = await parseCsvFile<Record<string, string>>(file);
      setRows(parsed.rows);
      submit("preview", parsed.rows);
    } catch {
      setReadError(t`The file could not be read as CSV`);
    }
  };

  const errorsByRow = new Map(
    (result?.errors ?? []).map((error) => [error.row, error.message])
  );
  const previewRows = [
    ...(result?.creates ?? []).map((create) => ({
      row: create.row,
      action: t`Create`,
      code: create.wbsCode ?? "",
      name: create.name
    })),
    ...(result?.updates ?? []).map((update) => ({
      row: update.row,
      action: t`Update`,
      code: update.wbsCode ?? "",
      name: update.name
    })),
    ...(result?.errors ?? []).map((error) => ({
      row: error.row,
      action: t`Error`,
      code: "",
      name: ""
    }))
  ]
    .filter(
      (row, index, all) =>
        all.findIndex((other) => other.row === row.row) === index
    )
    .sort((a, b) => a.row - b.row);
  const errorCount = result?.errors.length ?? 0;
  const message = readError ?? (response?.success ? null : response?.message);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>
            <Trans>Import WBS</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Columns: Element ID, WBS Code, Parent WBS Code, Type, Name, Start,
              Target, Budget, Predecessors. A row with an Element ID updates
              that element; a blank cell keeps its value. Nothing is deleted.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="flex flex-col gap-4">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={t`CSV file`}
            className="text-sm"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          {message && <p className="text-sm text-destructive">{message}</p>}
          {result && (
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Row</Trans>
                    </Th>
                    <Th>
                      <Trans>Action</Trans>
                    </Th>
                    <Th>
                      <Trans>WBS code</Trans>
                    </Th>
                    <Th>
                      <Trans>Name</Trans>
                    </Th>
                    <Th>
                      <Trans>Error</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {previewRows.map((row) => (
                    <Tr key={row.row}>
                      <Td className="tabular-nums">{row.row}</Td>
                      <Td>{row.action}</Td>
                      <Td className="tabular-nums">{row.code}</Td>
                      <Td>{row.name}</Td>
                      <Td className="text-destructive">
                        {errorsByRow.get(row.row)}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={!result || errorCount > 0 || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
            onClick={() => submit("apply")}
          >
            {errorCount > 0 ? (
              <Trans>Fix {errorCount} errors to apply</Trans>
            ) : (
              <Trans>Apply</Trans>
            )}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
