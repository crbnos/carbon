// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { UserSelect } from "~/components/Selectors";
import {
  type AllMatchingSelection,
  allMatchingRequest
} from "~/components/Table";
import {
  resendInviteAllMatchingValidator,
  resendInviteValidator
} from "~/modules/users/users.models";
import { path } from "~/utils/path";
import {
  AllMatchingUsersNote,
  type BulkUserActionFetcher
} from "./AllMatchingUsers";

type ResendInviteModalProps = {
  userIds: string[];
  isOpen: boolean;
  /** Set when the action applies to every matching user of the list. */
  allMatching?: AllMatchingSelection | null;
  /** Posts the every-matching-user request. The table owns it, so its result
   *  toast still shows after this modal closes. */
  allMatchingFetcher?: BulkUserActionFetcher;
  onClose: () => void;
};

const ResendInviteModal = ({
  userIds,
  isOpen,
  allMatching,
  allMatchingFetcher,
  onClose
}: ResendInviteModalProps) => {
  const { t } = useLingui();
  // The modal stays open until the action answers: it unmounts when it
  // closes, and the result is read here.
  const fetcher = useAction({
    onSuccess: (data) =>
      toast.success(
        data.data?.queued
          ? t`Successfully added invites to queue`
          : t`Successfully resent invite`
      ),
    onSettled: () => onClose()
  });
  const isSingleUser = !allMatching && userIds.length === 1;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {isSingleUser ? (
              <Trans>Send Invite</Trans>
            ) : (
              <Trans>Send Invites</Trans>
            )}
          </ModalTitle>
        </ModalHeader>

        <ModalBody>
          <p className="text-sm text-muted-foreground mb-2">
            {isSingleUser ? (
              <Trans>
                Are you sure you want to send an invite to this user?
              </Trans>
            ) : (
              <Trans>
                Are you sure you want to send an invite to these users?
              </Trans>
            )}
          </p>
          <p className="text-sm text-muted-foreground mb-2">
            <Trans>
              A new invite link is sent. A link sent before stops working.
            </Trans>
          </p>
          {allMatching ? (
            <AllMatchingUsersNote />
          ) : (
            <UserSelect value={userIds} readOnly isMulti />
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="ghost" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <ValidatedForm
              method="post"
              action={path.to.resendInvite}
              validator={
                allMatching
                  ? resendInviteAllMatchingValidator
                  : resendInviteValidator
              }
              onSubmit={allMatching ? onClose : undefined}
              fetcher={allMatching ? allMatchingFetcher : fetcher}
            >
              {allMatching && (
                <input
                  type="hidden"
                  name="allMatching"
                  value={JSON.stringify(allMatchingRequest(allMatching))}
                />
              )}
              {(allMatching ? [] : userIds).map((id, index) => (
                <input
                  key={id}
                  type="hidden"
                  name={`users[${index}]`}
                  value={id}
                />
              ))}
              <Button type="submit" isLoading={fetcher.isPending}>
                <Trans>Send</Trans>
              </Button>
            </ValidatedForm>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ResendInviteModal;
