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
  onClose,
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
            {isSingleUser ? "Deactivate Employee" : "Deactivate Employees"}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="mb-2">
            Are you sure you want to deactive
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
                Deactivate
              </Button>
            </ValidatedForm>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default DeactivateUsersModal;
