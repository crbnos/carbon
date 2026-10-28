// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  MENU_ITEM_SHORTCUTS,
  MenuIcon,
  MenuItem,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { LuCalendar, LuEye, LuHash, LuStar, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { CurrencyRevaluationRunListItem } from "../../types";
import CurrencyRevaluationRunStatus from "./CurrencyRevaluationRunStatus";

type CurrencyRevaluationRunTableProps = {
  data: CurrencyRevaluationRunListItem[];
  count: number;
  infinite: InfiniteOptions;
  primaryAction?: ReactNode;
};

const CurrencyRevaluationRunTable = memo(
  ({
    data,
    count,
    primaryAction,
    infinite
  }: CurrencyRevaluationRunTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [selectedRun, setSelectedRun] =
      useState<CurrencyRevaluationRunListItem | null>(null);
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<CurrencyRevaluationRunListItem>[]>(
      () => [
        {
          accessorKey: "currencyRevaluationRunId",
          header: t`Run ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.currencyRevaluationRun(row.original.id)}>
              {row.original.currencyRevaluationRunId}
            </Hyperlink>
          ),
          meta: {
            mobile: "P1",
            icon: <LuHash />
          }
        },
        {
          accessorKey: "periodEnd",
          header: t`Period End`,
          cell: ({ row }) => (
            <DateTime value={row.original.periodEnd} variant="date" />
          ),
          meta: {
            mobile: "P3",
            filter: {
              type: "dateRange"
            },
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <CurrencyRevaluationRunStatus status={row.original.status} />
          ),
          meta: {
            mobile: "P2",
            icon: <LuStar />
          }
        },
        {
          accessorKey: "postedAt",
          header: t`Posted At`,
          cell: ({ row }) =>
            row.original.postedAt ? (
              <DateTime value={row.original.postedAt} variant="date" />
            ) : (
              "—"
            ),
          meta: {
            icon: <LuCalendar />
          }
        }
      ],
      [t]
    );

    const renderContextMenu = useCallback(
      (row: CurrencyRevaluationRunListItem) => (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.view}
            disabled={!permissions.can("view", "accounting")}
            onClick={() => navigate(path.to.currencyRevaluationRun(row.id))}
          >
            <MenuIcon icon={<LuEye />} />
            <Trans>View Run</Trans>
          </MenuItem>
          {row.status === "Draft" && (
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              disabled={!permissions.can("delete", "accounting")}
              destructive
              onClick={() => {
                setSelectedRun(row);
                deleteModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              <Trans>Delete</Trans>
            </MenuItem>
          )}
        </>
      ),
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<CurrencyRevaluationRunListItem>
          infinite={infinite}
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title={t`Currency Revaluation`}
        />
        {selectedRun && (
          <ConfirmDelete
            action={path.to.deleteCurrencyRevaluationRun(selectedRun.id)}
            isOpen={deleteModal.isOpen}
            name={selectedRun.currencyRevaluationRunId}
            text={t`Are you sure you want to delete ${selectedRun.currencyRevaluationRunId}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedRun(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedRun(null);
            }}
          />
        )}
      </>
    );
  }
);

CurrencyRevaluationRunTable.displayName = "CurrencyRevaluationRunTable";
export default CurrencyRevaluationRunTable;
