import { useCarbon } from "@carbon/auth";
import { Number, SelectControlled, Submit, ValidatedForm } from "@carbon/form";
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
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useEffect, useState } from "react";
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
  LuGitPullRequestArrow,
  LuStar,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { Hidden, Item, useConfigurableItems } from "~/components/Form";
import { Confirm } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import {
  getMethodValidator,
  makeMethodVersionValidator
} from "../../items.models";
import type { MakeMethod } from "../../types";
import { CreateChangeOrderModal } from "../ChangeOrder";
import { getPathToMakeMethod } from "../Methods/utils";
import { getLinkToItemDetails } from "./ItemForm";
import MakeMethodVersionStatus from "./MakeMethodVersionStatus";

type MakeMethodToolsProps = {
  itemId: string;
  type: ItemType;
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
  const { t } = useLingui();
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
  const changeOrderModal = useDisclosure();
  const activeMethodModal = useDisclosure();
  const canCreateChangeOrder =
    (type === "Part" || type === "Tool") && permissions.can("create", "parts");
  const itemLink = type && itemId ? getLinkToItemDetails(type, itemId) : null;

  const activeMethod =
    makeMethods.find((m) => m.id === activeMethodId) ?? makeMethods[0];

  const maxVersion = Math.max(...makeMethods.map((m) => m.version));
  const [selectedVersion, setSelectedVersion] =
    useState<MakeMethod>(activeMethod);

  // Reset selectedVersion when itemId or activeMethod changes
  useEffect(() => {
    setSelectedVersion(activeMethod);
  }, [activeMethod]);

  // State for Get and Save Method modals
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  // State for Get Method modal - source versions
  const [sourceMakeMethods, setSourceMakeMethods] = useState<
    { label: JSX.Element; value: string }[]
  >([]);
  const [selectedSourceMethod, setSelectedSourceMethod] = useState<
    string | null
  >(null);

  // State for Save Method modal - target versions
  const [targetMakeMethods, setTargetMakeMethods] = useState<
    { label: JSX.Element; value: string }[]
  >([]);
  const [selectedTargetMethod, setSelectedTargetMethod] = useState<
    string | null
  >(null);

  const getSourceMakeMethods = async (sourceItemId: string) => {
    setSourceMakeMethods([]);
    setSelectedSourceMethod(null);
    if (!carbon) return;
    const { data, error } = await carbon
      .from("makeMethod")
      .select("id, version, status")
      .eq("itemId", sourceItemId)
      .eq("companyId", companyId)
      .order("version", { ascending: false });

    if (error) {
      toast.error(error.message);
    }

    // For source, we can select any version (Draft, Active, or Archived)
    setSourceMakeMethods(
      data?.map(({ id, version, status }) => ({
        label: (
          <div className="flex items-center gap-2">
            <Badge variant="outline">V{version}</Badge>{" "}
            <MakeMethodVersionStatus status={status} />
          </div>
        ),
        value: id
      })) ?? []
    );

    if (data?.length === 1) {
      setSelectedSourceMethod(data[0].id);
    }
  };

  const getTargetMakeMethods = async (targetItemId: string) => {
    setTargetMakeMethods([]);
    setSelectedTargetMethod(null);
    if (!carbon) return;
    const { data, error } = await carbon
      .from("makeMethod")
      .select("id, version, status, changeOrderId")
      .eq("itemId", targetItemId)
      .eq("companyId", companyId)
      .order("version", { ascending: false });

    if (error) {
      toast.error(error.message);
    }

    // Only Draft versions can be overwritten - Active and Archived are read-only.
    // Exclude CO-owned drafts (changeOrderId set) — a CO's draft is authored via
    // its own BOM/BOP surfaces, not clobbered wholesale by this copy-method tool.
    const availableVersions =
      data?.filter((m) => m.status === "Draft" && !m.changeOrderId) ?? [];

    setTargetMakeMethods(
      availableVersions.map(({ id, version, status }) => ({
        label: (
          <div className="flex items-center gap-2">
            <Badge variant="outline">V{version}</Badge>{" "}
            <MakeMethodVersionStatus status={status} />
          </div>
        ),
        value: id
      }))
    );

    if (availableVersions.length === 1) {
      setSelectedTargetMethod(availableVersions[0].id);
    }
  };

  return (
    <Fragment key={itemId}>
      <Menubar>
        <HStack className="w-full justify-between">
          <HStack spacing={0}>
            <MenubarItem
              isLoading={isGetMethodLoading}
              isDisabled={
                !permissions.can("update", "parts") ||
                isGetMethodLoading ||
                activeMethod.status !== "Draft" // Can only overwrite Draft versions
              }
              leftIcon={<LuGitBranch />}
              onClick={getMethodModal.onOpen}
            >
              <Trans>Get Method</Trans>
            </MenubarItem>
            <MenubarItem
              isDisabled={
                !permissions.can("update", "parts") || isSaveMethodLoading
              }
              isLoading={isSaveMethodLoading}
              leftIcon={<LuGitMerge />}
              onClick={saveMethodModal.onOpen}
            >
              <Trans>Save Method</Trans>
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
                  {canCreateChangeOrder && (
                    <DropdownMenuItem onClick={changeOrderModal.onOpen}>
                      <DropdownMenuIcon icon={<LuGitPullRequestArrow />} />
                      New Change Order
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
              setSourceMakeMethods([]);
              setSelectedSourceMethod(null);
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
                  Overwrite the current version with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="targetId" value={activeMethodId} />
                <VStack spacing={4}>
                  <Alert variant="destructive" className="mt-4">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      This will overwrite version {activeMethod.version} of this
                      manufacturing method
                    </AlertTitle>
                  </Alert>
                  <Item
                    name="itemId"
                    label={t`Source Item`}
                    type={type}
                    blacklist={[itemId, ...configurableItemIds]}
                    includeInactive={includeInactive}
                    replenishmentSystem="Make"
                    onChange={(value) => {
                      if (value) {
                        getSourceMakeMethods(value?.value);
                      } else {
                        setSourceMakeMethods([]);
                        setSelectedSourceMethod(null);
                      }
                    }}
                  />
                  <SelectControlled
                    name="sourceId"
                    options={sourceMakeMethods}
                    label={t`Source Version`}
                    value={selectedSourceMethod ?? undefined}
                    onChange={(value) => {
                      if (value) {
                        setSelectedSourceMethod(value?.value);
                      } else {
                        setSelectedSourceMethod(null);
                      }
                    }}
                    placeholder={
                      sourceMakeMethods.length === 0
                        ? t`Select an item first`
                        : undefined
                    }
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
                <Submit
                  isDisabled={!hasMethodParts || !selectedSourceMethod}
                  variant="destructive"
                >
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
              setTargetMakeMethods([]);
              setSelectedTargetMethod(null);
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
                  Save version {activeMethod.version} to another item's method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden name="sourceId" value={activeMethodId} />
                <VStack spacing={4}>
                  <Item
                    name="itemId"
                    label={t`Target Item`}
                    type={type}
                    includeInactive={includeInactive}
                    blacklist={[itemId, ...configurableItemIds]}
                    replenishmentSystem="Make"
                    onChange={(value) => {
                      if (value) {
                        getTargetMakeMethods(value?.value);
                      } else {
                        setTargetMakeMethods([]);
                        setSelectedTargetMethod(null);
                      }
                    }}
                  />
                  <SelectControlled
                    name="targetId"
                    options={targetMakeMethods}
                    label={t`Target Version`}
                    value={selectedTargetMethod ?? undefined}
                    onChange={(value) => {
                      if (value) {
                        setSelectedTargetMethod(value?.value);
                      } else {
                        setSelectedTargetMethod(null);
                      }
                    }}
                    placeholder={
                      targetMakeMethods.length === 0
                        ? t`No draft versions available`
                        : undefined
                    }
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
                <Submit isDisabled={!hasMethodParts || !selectedTargetMethod}>
                  <Trans>Confirm</Trans>
                </Submit>
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
                    label={t`New Version`}
                    helperText={t`The new version number of the method`}
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
                <Submit>
                  <Trans>Create Version</Trans>
                </Submit>
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
          confirmText={t`Make Active`}
          title={t`Set Version ${selectedVersion.version} as Active Version?`}
          text={t`This will make this version read-only and replace any material make methods with this version.`}
          isOpen
          onSubmit={() => {
            activeMethodModal.onClose();
            setSelectedVersion(activeMethod);
          }}
          onCancel={activeMethodModal.onClose}
        />
      )}

      {changeOrderModal.isOpen && (
        <CreateChangeOrderModal
          itemId={itemId}
          onClose={changeOrderModal.onClose}
        />
      )}
    </Fragment>
  );
};

function AdvancedSection({
  onChange
}: {
  onChange?: (hasSelection: boolean) => void;
}) {
  const { t } = useLingui();
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
      label: t`Parameters`,
      checked: parameters,
      onChange: setParameters
    },
    { name: "tools", label: t`Tools`, checked: tools, onChange: setTools },
    { name: "steps", label: t`Steps`, checked: steps, onChange: setSteps },
    {
      name: "workInstructions",
      label: t`Work Instructions`,
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
