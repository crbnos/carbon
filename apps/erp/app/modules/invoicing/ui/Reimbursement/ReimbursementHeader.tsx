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
import { Trans, useLingui } from "@lingui/react/macro";
import { LuBanknote, LuCheckCheck, LuPencil, LuTicketX } from "react-icons/lu";
import { Form, Link, useMatch, useNavigation, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { Confirm } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import PayExpenseModal from "./PayExpenseModal";
import ReimbursementStatus from "./ReimbursementStatus";

type Reimbursement = Database["public"]["Tables"]["reimbursement"]["Row"];

/**
 * The reimbursement's identity and lifecycle. A Draft is edited and posted, a
 * Posted one is paid out (while anything is still owed) or voided. In edit
 * mode the form carries Save and Save and post, so the header only names the
 * document.
 */
const ReimbursementHeader = () => {
  const { t } = useLingui();
  const { reimbursementId } = useParams();
  if (!reimbursementId) throw new Error("reimbursementId not found");

  const routeData = useRouteData<{
    reimbursement: Reimbursement;
    balanceDue: number;
    defaultBankAccount: string;
  }>(path.to.reimbursement(reimbursementId));

  const navigation = useNavigation();
  const permissions = usePermissions();
  const payModal = useDisclosure();
  const voidModal = useDisclosure();
  const isEditing = Boolean(
    useMatch(path.to.reimbursementEdit(reimbursementId))
  );

  const reimbursement = routeData?.reimbursement;
  if (!reimbursement) {
    throw new Error("Could not find reimbursement in routeData");
  }

  const status = reimbursement.status;
  const balanceDue = routeData?.balanceDue ?? 0;
  const canUpdate = permissions.can("update", "invoicing");
  const isDraft = status === "Draft";
  const isPosted = status === "Posted";
  const canPost = isDraft && canUpdate;
  const canVoid = isPosted && canUpdate;
  // Posted and still owed. `balanceDue` comes from the settlement rows, so a
  // fully paid reimbursement simply stops offering the action.
  const canPay =
    isPosted && balanceDue > 0 && permissions.can("create", "invoicing");

  const postAction = path.to.reimbursementPost(reimbursement.id);

  return (
    <>
      <DocumentPageHeader
        title={reimbursement.reimbursementId}
        status={<ReimbursementStatus status={status} />}
        meta={[
          <Trans key="employee">
            For <EmployeeAvatar employeeId={reimbursement.employeeId} />
          </Trans>,
          <Trans key="created">
            Created{" "}
            <DateTime value={reimbursement.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={reimbursement.createdBy} />
          </Trans>,
          reimbursement.postingDate ? (
            reimbursement.postedBy ? (
              <Trans key="posted">
                Posted{" "}
                <DateTime value={reimbursement.postingDate} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={reimbursement.postedBy} />
              </Trans>
            ) : (
              <Trans key="posted">
                Posted{" "}
                <DateTime value={reimbursement.postingDate} variant="date" />
              </Trans>
            )
          ) : null,
          reimbursement.voidedAt ? (
            reimbursement.voidedBy ? (
              <Trans key="voided">
                Voided{" "}
                <DateTime value={reimbursement.voidedAt} variant="date" /> by{" "}
                <EmployeeAvatar employeeId={reimbursement.voidedBy} />
              </Trans>
            ) : (
              <Trans key="voided">
                Voided{" "}
                <DateTime value={reimbursement.voidedAt} variant="date" />
              </Trans>
            )
          ) : null
        ]}
        menuItems={
          isPosted ? (
            <DropdownMenuItem
              disabled={!canVoid}
              destructive
              onClick={voidModal.onOpen}
            >
              <DropdownMenuIcon icon={<LuTicketX />} />
              <Trans>Void</Trans>
            </DropdownMenuItem>
          ) : undefined
        }
        actions={
          isEditing ? undefined : (
            <>
              {isDraft && canUpdate && (
                <Button variant="secondary" leftIcon={<LuPencil />} asChild>
                  <Link to={path.to.reimbursementEdit(reimbursement.id)}>
                    <Trans>Edit</Trans>
                  </Link>
                </Button>
              )}
              {canPost && (
                <Form method="post" action={postAction}>
                  <Button
                    type="submit"
                    variant="primary"
                    leftIcon={<LuCheckCheck />}
                    isLoading={navigation.formAction === postAction}
                  >
                    <Trans>Post</Trans>
                  </Button>
                </Form>
              )}
              {canPay && (
                <Button
                  variant="primary"
                  leftIcon={<LuBanknote />}
                  onClick={payModal.onOpen}
                >
                  <Trans>Pay expense</Trans>
                </Button>
              )}
            </>
          )
        }
      />

      {canPay && payModal.isOpen && (
        <PayExpenseModal
          id={reimbursement.id}
          displayId={reimbursement.reimbursementId}
          currencyCode={reimbursement.currencyCode}
          balanceDue={balanceDue}
          defaultBankAccount={routeData?.defaultBankAccount ?? ""}
          open={payModal.isOpen}
          onClose={payModal.onClose}
        />
      )}

      {canVoid && voidModal.isOpen && (
        <Confirm
          action={path.to.reimbursementVoid(reimbursement.id)}
          title={t`Void Reimbursement`}
          text={t`Are you sure you want to void ${reimbursement.reimbursementId}? This posts a reversing journal entry and cannot be undone.`}
          confirmText={t`Void`}
          confirmVariant="destructive"
          onCancel={voidModal.onClose}
          onSubmit={voidModal.onClose}
        />
      )}
    </>
  );
};

export default ReimbursementHeader;
