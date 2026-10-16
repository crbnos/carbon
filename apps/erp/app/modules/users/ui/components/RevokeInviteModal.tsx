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
import { revokeInviteValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";

type RevokeInviteModalProps = {
  userIds: string[];
  isOpen: boolean;
  onClose: () => void;
};

const RevokeInviteModal = ({
  userIds,
  isOpen,
  onClose
}: RevokeInviteModalProps) => {
  const { t } = useLingui();
  // The modal stays open until the action answers: it unmounts when it
  // closes, and the result is read here.
  const fetcher = useAction({
    onSuccess: (data) => toast.success(t`Successfully revoked invites`),
    onSettled: () => onClose()
  });
  const isSingleUser = userIds.length === 1;

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
              <Trans>Revoke Invite</Trans>
            ) : (
              <Trans>Revoke Invites</Trans>
            )}
          </ModalTitle>
        </ModalHeader>

        <ModalBody>
          <p className="mb-2">
            {isSingleUser ? (
              <Trans>
                Are you sure you want to revoke the invitation for this user?
              </Trans>
            ) : (
              <Trans>
                Are you sure you want to revoke the invitations for these users?
              </Trans>
            )}
          </p>
          <UserSelect value={userIds} readOnly isMulti />
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="ghost" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <ValidatedForm
              method="post"
              action={path.to.revokeInvite}
              validator={revokeInviteValidator}
              fetcher={fetcher}
            >
              {userIds.map((id, index) => (
                <input
                  key={id}
                  type="hidden"
                  name={`users[${index}]`}
                  value={id}
                />
              ))}
              <Button
                variant="destructive"
                type="submit"
                isLoading={fetcher.isPending}
              >
                <Trans>Revoke</Trans>
              </Button>
            </ValidatedForm>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RevokeInviteModal;
