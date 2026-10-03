// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuRepeat, LuTrash } from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import DepreciationRunStatus from "./DepreciationRunStatus";

type DepreciationRun = Database["public"]["Tables"]["depreciationRun"]["Row"];

const DepreciationRunHeader = () => {
  const { t } = useLingui();
  const { depreciationRunId } = useParams();
  if (!depreciationRunId) throw new Error("depreciationRunId not found");

  const routeData = useRouteData<{ run: DepreciationRun }>(
    path.to.depreciationRun(depreciationRunId)
  );

  const permissions = usePermissions();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const deleteModal = useDisclosure();
  const repeatModal = useDisclosure();

  const run = routeData?.run;
  if (!run) throw new Error("Could not find run in routeData");

  const isDraft = run.status === "Draft";
  const isPosted = run.status === "Posted";

  return (
    <>
      <DocumentPageHeader
        title={run.depreciationRunId}
        status={<DepreciationRunStatus status={run.status} />}
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
                  disabled={!permissions.can("create", "accounting")}
                  onClick={repeatModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuRepeat />} />
                  <Trans>Repeat Run</Trans>
                </DropdownMenuItem>
              )}
              {isDraft && (
                <DropdownMenuItem
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
          ) : undefined
        }
      />

      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteDepreciationRun(depreciationRunId)}
          isOpen={deleteModal.isOpen}
          name={run.depreciationRunId}
          text={t`Are you sure you want to delete ${run.depreciationRunId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.depreciationRuns);
          }}
        />
      )}

      {repeatModal.isOpen && (
        <Confirm
          action={path.to.repeatDepreciationRun(depreciationRunId)}
          isOpen={repeatModal.isOpen}
          title={t`Repeat Run`}
          text={t`This will create a new draft depreciation run for the same period (${formatDate(run.periodEnd)}), including only active assets not already covered by an existing run.`}
          confirmText={t`Create Repeat Run`}
          onCancel={repeatModal.onClose}
          onSubmit={repeatModal.onClose}
        />
      )}
    </>
  );
};

export default DepreciationRunHeader;
