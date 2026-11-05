// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCheckCheck,
  LuRefreshCw,
  LuRotateCcw,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import CurrencyRevaluationRunStatus from "./CurrencyRevaluationRunStatus";

type CurrencyRevaluationRun =
  Database["public"]["Tables"]["currencyRevaluationRun"]["Row"];

const CurrencyRevaluationRunHeader = () => {
  const { t } = useLingui();
  const { runId } = useParams();
  if (!runId) throw new Error("runId not found");

  const routeData = useRouteData<{ run: CurrencyRevaluationRun }>(
    path.to.currencyRevaluationRun(runId)
  );

  const permissions = usePermissions();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const deleteModal = useDisclosure();
  const recalculateModal = useDisclosure();
  const reverseModal = useDisclosure();

  const run = routeData?.run;
  if (!run) throw new Error("Could not find run in routeData");

  const isDraft = run.status === "Draft";
  const isPosted = run.status === "Posted";

  return (
    <>
      <DocumentPageHeader
        title={run.currencyRevaluationRunId}
        status={<CurrencyRevaluationRunStatus status={run.status} />}
        meta={[
          <Trans key="created">
            Created <DateTime value={run.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={run.createdBy} />
          </Trans>,
          run.postedAt ? (
            run.postedBy ? (
              <Trans key="posted">
                Posted <DateTime value={run.postedAt} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={run.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted <DateTime value={run.postedAt} variant="date" />
              </Trans>
            )
          ) : null
        ]}
        menuItems={
          isDraft || isPosted ? (
            <>
              {isPosted && (
                <DropdownMenuItem
                  disabled={!permissions.can("update", "accounting")}
                  destructive
                  onClick={reverseModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuRotateCcw />} />
                  <Trans>Undo</Trans>
                </DropdownMenuItem>
              )}
              {isDraft && (
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.delete}
                  disabled={!permissions.can("delete", "accounting")}
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              )}
            </>
          ) : undefined
        }
        actions={
          isDraft && permissions.can("update", "accounting") ? (
            <>
              <Button
                variant="secondary"
                leftIcon={<LuRefreshCw />}
                onClick={recalculateModal.onOpen}
              >
                <Trans>Recalculate</Trans>
              </Button>
              <fetcher.Form method="post" action="post">
                <Button
                  variant="primary"
                  type="submit"
                  leftIcon={<LuCheckCheck />}
                  isLoading={fetcher.state !== "idle"}
                >
                  <Trans>Post</Trans>
                </Button>
              </fetcher.Form>
            </>
          ) : undefined
        }
      />

      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteCurrencyRevaluationRun(runId)}
          isOpen={deleteModal.isOpen}
          name={run.currencyRevaluationRunId}
          text={t`Are you sure you want to delete ${run.currencyRevaluationRunId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.currencyRevaluationRuns);
          }}
        />
      )}

      {reverseModal.isOpen && (
        <ConfirmDelete
          action={path.to.reverseCurrencyRevaluationRun(runId)}
          isOpen={reverseModal.isOpen}
          name={run.currencyRevaluationRunId}
          title={t`Undo ${run.currencyRevaluationRunId}`}
          deleteText={t`Undo Run`}
          text={t`This will reverse the journals of ${run.currencyRevaluationRunId} and return it to Draft. You can then recalculate, post or delete it.`}
          onCancel={reverseModal.onClose}
          onSubmit={reverseModal.onClose}
        />
      )}

      {recalculateModal.isOpen && (
        <Confirm
          action={path.to.recalculateCurrencyRevaluationRun(runId)}
          isOpen={recalculateModal.isOpen}
          title={t`Recalculate Run`}
          text={t`This will rebuild ${run.currencyRevaluationRunId} from the foreign-currency items open at ${formatDate(run.periodEnd)}. The rates on the run are kept.`}
          confirmText={t`Recalculate`}
          onCancel={recalculateModal.onClose}
          onSubmit={recalculateModal.onClose}
        />
      )}
    </>
  );
};

export default CurrencyRevaluationRunHeader;
