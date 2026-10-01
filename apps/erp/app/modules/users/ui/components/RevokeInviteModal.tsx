// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { UserSelect } from "~/components/Selectors";
import { revokeInviteValidator } from "~/modules/users";
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
  const fetcher = useFetcher<{}>();
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
              onSubmit={onClose}
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
              <Button variant="destructive" type="submit">
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
