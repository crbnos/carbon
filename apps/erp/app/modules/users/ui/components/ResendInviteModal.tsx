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
import { resendInviteValidator } from "~/modules/users";
import { path } from "~/utils/path";

type ResendInviteModalProps = {
  userIds: string[];
  isOpen: boolean;
  onClose: () => void;
};

const ResendInviteModal = ({
  userIds,
  isOpen,
  onClose
}: ResendInviteModalProps) => {
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
              <Trans>Send Invite</Trans>
            ) : (
              <Trans>Send Invites</Trans>
            )}
          </ModalTitle>
        </ModalHeader>

        <ModalBody>
          <p className="mb-2">
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
          <UserSelect value={userIds} readOnly isMulti />
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="ghost" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <ValidatedForm
              method="post"
              action={path.to.resendInvite}
              validator={resendInviteValidator}
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
              <Button type="submit">
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
