// SPDX-License-Identifier: AGPL-3.0-only
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
import {
  type AllMatchingSelection,
  allMatchingRequest
} from "~/components/Table";
import {
  deactivateUsersAllMatchingValidator,
  deactivateUsersValidator
} from "~/modules/users/users.models";
import { path } from "~/utils/path";
import {
  AllMatchingUsersNote,
  type BulkUserActionFetcher
} from "./AllMatchingUsers";

type DeactivateUsersModalProps = {
  userIds: string[];
  isOpen: boolean;
  redirectTo?: string;
  /** Set when the action applies to every matching user of the list. */
  allMatching?: AllMatchingSelection | null;
  /** Posts the every-matching-user request. The table owns it, so its result
   *  toast still shows after this modal closes. */
  allMatchingFetcher?: BulkUserActionFetcher;
  onClose: () => void;
};

const DeactivateUsersModal = ({
  userIds,
  isOpen,
  redirectTo = path.to.employeeAccounts,
  allMatching,
  allMatchingFetcher,
  onClose
}: DeactivateUsersModalProps) => {
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
              action={path.to.deactivateUsers}
              validator={
                allMatching
                  ? deactivateUsersAllMatchingValidator
                  : deactivateUsersValidator
              }
              // Every matching user runs in the background: the route
              // answers data, not a redirect, so it posts through a fetcher.
              fetcher={allMatching ? allMatchingFetcher : undefined}
              onSubmit={onClose}
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
