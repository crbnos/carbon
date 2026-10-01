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
import { UserSelect } from "~/components/Selectors";
import { deactivateUsersValidator } from "~/modules/users";
import { path } from "~/utils/path";

type DeactivateUsersModalProps = {
  userIds: string[];
  isOpen: boolean;
  redirectTo?: string;
  onClose: () => void;
};

const DeactivateUsersModal = ({
  userIds,
  isOpen,
  redirectTo = path.to.employeeAccounts,
  onClose
}: DeactivateUsersModalProps) => {
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
              <Trans>Deactivate Employee</Trans>
            ) : (
              <Trans>Deactivate Employees</Trans>
            )}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="mb-2">
            {isSingleUser ? (
              <Trans>Are you sure you want to deactivate this user?</Trans>
            ) : (
              <Trans>Are you sure you want to deactivate these users?</Trans>
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
              action={path.to.deactivateUsers}
              validator={deactivateUsersValidator}
              onSubmit={onClose}
            >
              {userIds.map((id, index) => (
                <input
                  key={id}
                  type="hidden"
                  name={`users[${index}]`}
                  value={id}
                />
              ))}
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <Button variant="destructive" type="submit">
                <Trans>Deactivate</Trans>
              </Button>
            </ValidatedForm>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default DeactivateUsersModal;
