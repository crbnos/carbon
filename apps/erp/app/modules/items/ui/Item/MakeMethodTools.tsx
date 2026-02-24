// biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
import { Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
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
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheck,
  LuChevronDown,
  LuChevronRight,
  LuCirclePlus,
  LuCopy,
  LuGitBranch,
  LuGitFork,
  LuGitMerge,
  LuStar,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { Hidden, Item, useConfigurableItems } from "~/components/Form";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import {
  getMethodValidator,
  makeMethodVersionValidator
} from "../../items.models";
import type { MakeMethod } from "../../types";
import { getPathToMakeMethod } from "../Methods/utils";
import { getLinkToItemDetails } from "./ItemForm";
import MakeMethodVersionStatus from "./MakeMethodVersionStatus";

type MakeMethodToolsProps = {
  itemId: string;
  type: MethodItemType;
  makeMethods: MakeMethod[];
  currentMethodId?: string;
};

const MakeMethodTools = ({
  itemId,
  makeMethods,
  type,
  currentMethodId
}: MakeMethodToolsProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ error: string | null }>();
  const params = useParams();
  const { methodId, makeMethodId } = params;
  const activeMethodId = currentMethodId ?? makeMethodId ?? methodId;

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
  const configurableItemIds = useConfigurableItems();

  const getMethodModal = useDisclosure();
  const saveMethodModal = useDisclosure();
  const [hasMethodParts, setHasMethodParts] = useState(true);
  const newVersionModal = useDisclosure();
  const activeMethodModal = useDisclosure();
  const itemLink = type && itemId ? getLinkToItemDetails(type, itemId) : null;

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
                      const isCurrent = makeMethod.id === activeMethodId;

                      return (
                        <DropdownMenuSub key={makeMethod.id}>
                          <DropdownMenuSubTrigger>
                            <Link
                              to={getPathToMakeMethod(
                                type,
                                itemId,
                                makeMethod.id
                              )}
                              className="flex items-center justify-between gap-4"
                            >
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
                            </Link>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent>
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

                              {/* <DropdownMenuItem
                                destructive
                                disabled={
                                  makeMethod.status === "Active" ||
                                  !permissions.can("delete", "parts")
                                }
                              >
                                <DropdownMenuIcon icon={<LuTrash />} />
                                Delete Version
                              </DropdownMenuItem> */}
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
                  <Alert variant="destructive" className="mt-4">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      This will overwrite the existing manufacturing method
                    </AlertTitle>
                  </Alert>
                  <Item
                    name="sourceId"
                    label="Source Method"
                    type={type}
                    blacklist={configurableItemIds}
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

                  <AdvancedSection onChange={setHasMethodParts} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={getMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit isDisabled={!hasMethodParts} variant="destructive">
                  Confirm
                </Submit>
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
                    blacklist={[itemId, ...configurableItemIds]}
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
                  <AdvancedSection onChange={setHasMethodParts} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={saveMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit isDisabled={!hasMethodParts}>Confirm</Submit>
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
                version: maxVersion + 1
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

function AdvancedSection({
  onChange
}: {
  onChange?: (hasSelection: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [billOfMaterial, setBillOfMaterial] = useState(true);
  const [billOfProcess, setBillOfProcess] = useState(true);
  const [parameters, setParameters] = useState(true);
  const [tools, setTools] = useState(true);
  const [steps, setSteps] = useState(true);
  const [workInstructions, setWorkInstructions] = useState(true);

  const hasSelection =
    billOfMaterial ||
    (billOfProcess && (parameters || tools || steps || workInstructions));

  useEffect(() => {
    onChange?.(hasSelection);
  }, [hasSelection, onChange]);

  const processChildren = [
    {
      name: "parameters",
      label: "Parameters",
      checked: parameters,
      onChange: setParameters
    },
    { name: "tools", label: "Tools", checked: tools, onChange: setTools },
    { name: "steps", label: "Steps", checked: steps, onChange: setSteps },
    {
      name: "workInstructions",
      label: "Work Instructions",
      checked: workInstructions,
      onChange: setWorkInstructions
    }
  ];

  return (
    <Collapsible className="w-full" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 px-0">
          <LuChevronRight
            className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
          />
          Advanced
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount className={cn(!open && "hidden")}>
        <VStack spacing={2} className="pt-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="billOfMaterial"
              name="billOfMaterial"
              checked={billOfMaterial}
              onCheckedChange={(checked) => setBillOfMaterial(!!checked)}
            />
            <label
              htmlFor="billOfMaterial"
              className="text-sm font-medium leading-none"
            >
              Bill of Material
            </label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="billOfProcess"
              name="billOfProcess"
              checked={billOfProcess}
              onCheckedChange={(checked) => setBillOfProcess(!!checked)}
            />
            <label
              htmlFor="billOfProcess"
              className="text-sm font-medium leading-none"
            >
              Bill of Process
            </label>
          </div>
          <VStack spacing={2} className="pl-6">
            {processChildren.map(({ name, label, checked, onChange }) => (
              <div key={name} className="flex items-center space-x-2">
                <Checkbox
                  id={name}
                  name={name}
                  disabled={!billOfProcess}
                  checked={billOfProcess ? checked : false}
                  onCheckedChange={(val) => onChange(!!val)}
                />
                <label
                  htmlFor={name}
                  className={cn(
                    "text-sm font-medium leading-none",
                    !billOfProcess && "text-muted-foreground"
                  )}
                >
                  {label}
                </label>
              </div>
            ))}
          </VStack>
        </VStack>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default MakeMethodTools;
