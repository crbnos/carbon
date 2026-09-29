import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { type RowsByTable, totalScopeRows } from "../../backups.service";

// Shared by a failed restore and a failed demo data apply, whose safety snapshots
// refuse on the same out-of-scope rows. Callers own the differing copy and the submit.
export function PurgeCorruptedRowsModal({
  rowsByTable,
  description,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  rowsByTable: RowsByTable[];
  description: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Distinct ROWS, not per-edge violations — a row escaping scope through three
  // of its FKs is one row, and this number sits on an irreversible-delete button.
  const purgeRowCount = totalScopeRows(rowsByTable);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Plural
              value={purgeRowCount}
              one="Permanently delete # row?"
              other="Permanently delete # rows?"
            />
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground">{description}</p>
          {/* Per TABLE, not per FK edge: the title counts distinct rows,
              and a per-edge list beside it would show larger numbers for
              the same delete. */}
          <ul className="mt-3 flex flex-col gap-1 text-xs font-mono">
            {rowsByTable.map((t) => (
              <li key={t.table} className="flex justify-between gap-3">
                <span className="break-all">{t.table}</span>
                <span className="tabular-nums shrink-0">
                  {t.rows.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
