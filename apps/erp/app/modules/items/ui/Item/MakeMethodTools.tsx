import { Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
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
  cn,
  toast,
  useDisclosure,
} from "@carbon/react";
import { Link, useFetcher, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheck,
  LuChevronDown,
  LuCirclePlus,
  LuCopy,
  LuEye,
  LuGitBranch,
  LuGitFork,
  LuGitMerge,
  LuPencil,
  LuStar,
  LuTrash,
  LuTriangleAlert,
} from "react-icons/lu";
import { Hidden, Item } from "~/components/Form";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import {
  getMethodValidator,
  makeMethodVersionValidator,
} from "../../items.models";
import type { MakeMethod } from "../../types";
import { getPathToMakeMethod } from "../Methods/utils";
import { getLinkToItemDetails } from "./ItemForm";
import MakeMethodVersionStatus from "./MakeMethodVersionStatus";

type MakeMethodToolsProps = {
  itemId: string;
  type: MethodItemType;
  makeMethods: MakeMethod[];
};

const MakeMethodTools = ({
  itemId,
  makeMethods,
  type,
}: MakeMethodToolsProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ error: string | null }>();
  const params = useParams();
  const { methodId, makeMethodId } = params;

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
  const newVersionModal = useDisclosure();
  const activeMethodModal = useDisclosure();
  const itemLink = type && itemId ? getLinkToItemDetails(type, itemId) : null;

  const activeMethodId = makeMethodId ?? methodId;
  const activeMethod =
    makeMethods.find((m) => m.id === activeMethodId) ?? makeMethods[0];

  const maxVersion = Math.max(...makeMethods.map((m) => m.version));
  const [selectedVersion, setSelectedVersion] =
    useState<MakeMethod>(activeMethod);

  return (
    <>
      <Menubar>
        <HStack className="w-full justify-between">
          <HStack spacing={0}>
            <MenubarItem
              isLoading={isGetMethodLoading}
              isDisabled={
                !permissions.can("update", "parts") || isGetMethodLoading
              }
              leftIcon={<LuGitBranch />}
              onClick={getMethodModal.onOpen}
            >
              Get Method
            </MenubarItem>
            <MenubarItem
              isDisabled={
                !permissions.can("update", "parts") || isSaveMethodLoading
              }
              isLoading={isSaveMethodLoading}
              leftIcon={<LuGitMerge />}
              onClick={saveMethodModal.onOpen}
            >
              Save Method
            </MenubarItem>
            {itemLink && (
              <MenubarItem leftIcon={<LuGitFork />} asChild>
                <Link prefetch="intent" to={itemLink}>
                  Item Master
                </Link>
              </MenubarItem>
            )}
          </HStack>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" rightIcon={<LuChevronDown />}>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">V{activeMethod.version}</Badge>
                  <MakeMethodVersionStatus status={activeMethod.status} />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {makeMethods && makeMethods.length > 0 && (
                <>
                  {makeMethods
                    .sort((a, b) => b.version - a.version)
                    .map((makeMethod) => {
                      const isCurrent =
                        (makeMethod.id === methodId &&
                          makeMethodId === undefined) ||
                        makeMethod.id === makeMethodId;

                      const isReadOnly = makeMethod.status !== "Draft";

                      return (
                        <DropdownMenuSub key={makeMethod.id}>
                          <DropdownMenuSubTrigger className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                              <LuCheck
                                className={cn(!isCurrent && "opacity-0")}
                              />
                              <span>Version {makeMethod.version}</span>
                            </div>
                            <MakeMethodVersionStatus
                              status={makeMethod.status}
                              isActive={
                                makeMethod.status === "Active" ||
                                makeMethods.length === 1
                              }
                            />
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem asChild>
                                <Link
                                  to={getPathToMakeMethod(
                                    type,
                                    itemId,
                                    makeMethod.id
                                  )}
                                >
                                  <DropdownMenuIcon
                                    icon={isReadOnly ? <LuEye /> : <LuPencil />}
                                  />
                                  {isReadOnly ? "View Version" : "Edit Version"}
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  flushSync(() => {
                                    setSelectedVersion(makeMethod);
                                  });
                                  newVersionModal.onOpen();
                                }}
                              >
                                <DropdownMenuIcon icon={<LuCopy />} />
                                Copy Version
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                destructive
                                disabled={
                                  makeMethod.status === "Active" ||
                                  !permissions.can("delete", "parts")
                                }
                              >
                                <DropdownMenuIcon icon={<LuTrash />} />
                                Delete Version
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={makeMethod.status === "Active"}
                                onClick={() => {
                                  flushSync(() => {
                                    setSelectedVersion(makeMethod);
                                  });
                                  activeMethodModal.onOpen();
                                }}
                              >
                                <DropdownMenuIcon icon={<LuStar />} />
                                Set as Active Version
                              </DropdownMenuItem>
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                      );
                    })}
                  <DropdownMenuSeparator />
                  {permissions.can("create", "production") && (
                    <DropdownMenuItem onClick={newVersionModal.onOpen}>
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      New Version
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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

                  <Alert variant="destructive" className="mt-4">
                    <LuTriangleAlert className="h-4 w-4" />
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

      {newVersionModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              newVersionModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              fetcher={fetcher}
              action={`${path.to.newMakeMethodVersion}?methodToReplace=${activeMethodId}`}
              validator={makeMethodVersionValidator}
              defaultValues={{
                copyFromId: selectedVersion.id,
                activeVersionId:
                  makeMethods.length === 1 ? selectedVersion.id : undefined,
                version: maxVersion + 1,
              }}
              onSubmit={newVersionModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>New Version</ModalTitle>
                <ModalDescription>
                  Create a new version of the manufacturing method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="copyFromId" />
                <Hidden name="activeVersionId" />
                <VStack spacing={4}>
                  {makeMethods.length == 1 && (
                    <Alert variant="warning">
                      <LuTriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        This will set the current version of the make method to{" "}
                        <MakeMethodVersionStatus status="Active" /> making it
                        read-only.
                      </AlertTitle>
                    </Alert>
                  )}
                  <Number
                    name="version"
                    label="New Version"
                    helperText="The new version number of the method"
                    minValue={maxVersion + 1}
                    maxValue={100000}
                    step={1}
                  />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={newVersionModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit>Create Version</Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {activeMethodModal.isOpen && (
        <Confirm
          action={`${path.to.activeMethodVersion(
            selectedVersion.id
          )}?methodToReplace=${activeMethodId}`}
          confirmText="Make Active"
          title={`Set Version ${selectedVersion.version} as Active Version?`}
          text="This will make this version read-only and replace any material make methods with this version."
          isOpen
          onSubmit={() => {
            activeMethodModal.onClose();
            setSelectedVersion(activeMethod);
          }}
          onCancel={activeMethodModal.onClose}
        />
      )}
    </>
  );
};

export default MakeMethodTools;
