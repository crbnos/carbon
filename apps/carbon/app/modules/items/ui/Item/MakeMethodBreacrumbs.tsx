import { Submit, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Button,
  Checkbox,
  HStack,
  Menubar,
  MenubarItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack,
  toast,
  useDisclosure,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { LuAlertTriangle, LuDownload, LuUpload } from "react-icons/lu";
import { Hidden, Item } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { getMethodValidator } from "~/modules/items";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";

type MakeMethodBreadcrumbsProps = {
  itemId: string;
  type: MethodItemType;
};

const MakeMethodBreadcrumbs = ({
  itemId,
  type,
}: MakeMethodBreadcrumbsProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ error: string | null }>();

  const isGetMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.makeMethodGet;
  const isSaveMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.makeMethodSave;

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data?.error]);

  const [includeInactive, setIncludeInactive] = useState<boolean>(true);

  const getMethodModal = useDisclosure();
  const saveMethodModal = useDisclosure();

  return (
    <>
      <Menubar>
        <HStack className="w-full justify-end">
          <HStack spacing={0}>
            <MenubarItem
              isDisabled={
                !permissions.can("update", "parts") || isSaveMethodLoading
              }
              isLoading={isSaveMethodLoading}
              leftIcon={<LuUpload />}
              onClick={saveMethodModal.onOpen}
            >
              Save Method
            </MenubarItem>
            <MenubarItem
              isLoading={isGetMethodLoading}
              isDisabled={
                !permissions.can("update", "parts") || isGetMethodLoading
              }
              leftIcon={<LuDownload />}
              onClick={getMethodModal.onOpen}
            >
              Get Method
            </MenubarItem>
          </HStack>
        </HStack>
      </Menubar>

      {getMethodModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              getMethodModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              fetcher={fetcher}
              action={path.to.makeMethodGet}
              validator={getMethodValidator}
              onSubmit={getMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Get Method</ModalTitle>
                <ModalDescription>
                  Overwrite the item method with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="targetId" value={itemId} />
                <VStack spacing={4}>
                  <Item
                    name="sourceId"
                    label="Source Method"
                    type={type}
                    includeInactive={includeInactive}
                    disabledItems={[itemId]}
                    replenishmentSystem="Make"
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-inactive"
                      checked={includeInactive}
                      onCheckedChange={(checked) =>
                        setIncludeInactive(!!checked)
                      }
                    />
                    <label
                      htmlFor="include-inactive"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Include Inactive
                    </label>
                  </div>

                  <Alert variant="destructive">
                    <LuAlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                      This will overwrite the existing manufacturing method
                    </AlertTitle>
                  </Alert>
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={getMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit variant="destructive">Confirm</Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {saveMethodModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              saveMethodModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              fetcher={fetcher}
              action={path.to.makeMethodSave}
              validator={getMethodValidator}
              onSubmit={saveMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Save Method</ModalTitle>
                <ModalDescription>
                  Overwrite the target manufacturing method with the item method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="sourceId" value={itemId} />
                <VStack spacing={4}>
                  <Item
                    name="targetId"
                    label="Target Method"
                    type={type}
                    includeInactive={includeInactive}
                    disabledItems={[itemId]}
                    replenishmentSystem="Make"
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-inactive"
                      checked={includeInactive}
                      onCheckedChange={(checked) =>
                        setIncludeInactive(!!checked)
                      }
                    />
                    <label
                      htmlFor="include-inactive"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Include Inactive
                    </label>
                  </div>
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={saveMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit>Confirm</Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default MakeMethodBreadcrumbs;
