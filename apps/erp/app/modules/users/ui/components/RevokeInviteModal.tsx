import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
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
  onClose,
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
            {isSingleUser ? "Revoke Invite" : "Revoke Invites"}
          </ModalTitle>
        </ModalHeader>

        <ModalBody>
          <p className="mb-2">
            Are you sure you want to revoke the invitations for
            {isSingleUser ? " this user" : " these users"}?
          </p>
          <UserSelect value={userIds} readOnly isMulti />
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="ghost" onClick={onClose}>
              Cancel
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
                Revoke
              </Button>
            </ValidatedForm>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RevokeInviteModal;
