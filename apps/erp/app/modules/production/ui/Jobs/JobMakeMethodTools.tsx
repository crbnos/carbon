import { useCarbon } from "@carbon/auth";
import { SelectControlled, ValidatedForm } from "@carbon/form";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useEffect, useState } from "react";
import {
  LuChevronRight,
  LuGitBranch,
  LuGitFork,
  LuGitMerge,
  LuSettings,
  LuSquareStack,
  LuTriangleAlert
} from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { Link, useFetcher, useLocation, useParams } from "react-router";
import { PrintButton } from "~/components";
import { ConfiguratorModal } from "~/components/Configurator/ConfiguratorForm";
import { Hidden, Item, Submit, useConfigurableItems } from "~/components/Form";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import {
  type ConfigurationParameter,
  type ConfigurationParameterGroup,
  getConfigurationParameters
} from "~/modules/items";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import MakeMethodVersionStatus from "~/modules/items/ui/Item/MakeMethodVersionStatus";
import { QuoteLineMethodForm } from "~/modules/sales/ui/Quotes/QuoteLineMethodForm";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { getJobMethodValidator } from "../../production.models";
import type { Job, JobMakeMethod, JobMethod } from "../../types";

const JobMakeMethodTools = ({ makeMethod }: { makeMethod?: JobMakeMethod }) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { jobId, methodId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{ error: string | null }>();
  const routeData = useRouteData<{
    job: Job;
    method: Tree<JobMethod>;
  }>(path.to.job(jobId));

  const materialRouteData = useRouteData<{
    makeMethod: JobMakeMethod;
  }>(path.to.jobMakeMethod(jobId, methodId!));

  const itemId =
    materialRouteData?.makeMethod?.itemId ?? routeData?.job?.itemId;
  const itemType =
    materialRouteData?.makeMethod?.itemType ?? routeData?.job?.itemType;

  const itemLink =
    itemType && itemId
      ? getLinkToItemDetails(itemType as MethodItemType, itemId)
      : null;

  const isDisabled = ["Completed", "Cancelled", "In Progress"].includes(
    routeData?.job?.status ?? ""
  );

  const { pathname } = useLocation();

  const methodTree = routeData?.method;
  const hasMethods = methodTree?.children && methodTree.children.length > 0;

  const isGetMethodLoading =
    fetcher.state !== "idle" &&
    fetcher.formAction === path.to.jobMethodGet &&
    !fetcher.formData?.get("configuration");
  const isConfigureLoading =
    fetcher.state !== "idle" &&
    fetcher.formAction === path.to.jobMethodGet &&
    !!fetcher.formData?.get("configuration");
  const isSaveMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.jobMethodSave;

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data?.error]);

  const [includeInactive, setIncludeInactive] = useState<
    boolean | "indeterminate"
  >(true);

  const getMethodModal = useDisclosure();
  const saveMethodModal = useDisclosure();
  const [hasMethodParts, setHasMethodParts] = useState(true);

  const isJobDetails = pathname === path.to.jobDetails(jobId);
  const isJobMethod =
    isJobDetails || pathname === path.to.jobMethod(jobId, methodId!);
  const isJobMakeMethod =
    methodId && pathname === path.to.jobMakeMethod(jobId, methodId);

  const { carbon } = useCarbon();

  const configureSelectModal = useDisclosure();
  const configuratorModal = useDisclosure();

  // State for configurable items
  const configurableItemIds = useConfigurableItems();
  const [selectedConfigureItemId, setSelectedConfigureItemId] = useState<
    string | null
  >(null);
  const [configurationParameters, setConfigurationParameters] = useState<{
    groups: ConfigurationParameterGroup[];
    parameters: ConfigurationParameter[];
  }>({ groups: [], parameters: [] });

  const handleConfigureItemSelect = async (itemId: string | null) => {
    if (!itemId || !carbon) return;

    setSelectedConfigureItemId(itemId);

    // Fetch configuration parameters for the selected item
    const params = await getConfigurationParameters(carbon, itemId, companyId);
    setConfigurationParameters(params);

    configureSelectModal.onClose();
    configuratorModal.onOpen();
  };

  const saveConfiguration = async (configuration: Record<string, any>) => {
    configuratorModal.onClose();
    const sourceId = selectedConfigureItemId;
    setSelectedConfigureItemId(null);
    setConfigurationParameters({ groups: [], parameters: [] });
    fetcher.submit(
      {
        type: "item",
        targetId: jobId,
        sourceId,
        configuration: JSON.stringify(configuration),
        billOfMaterial: "on",
        billOfProcess: "on",
        parameters: "on",
        tools: "on",
        steps: "on",
        workInstructions: "on"
      },
      {
        method: "post",
        action: path.to.jobMethodGet
      }
    );
  };

  const {
    company: { id: companyId }
  } = useUser();
  const [makeMethods, setMakeMethods] = useState<
    { label: JSX.Element; value: string }[]
  >([]);
  const [selectedMakeMethod, setSelectedMakeMethod] = useState<string | null>(
    null
  );

  const getMakeMethods = async (itemId: string) => {
    setMakeMethods([]);
    setSelectedMakeMethod(null);
    if (!carbon) return;
    const { data, error } = await carbon
      .from("makeMethod")
      .select("id, version, status")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .order("version", { ascending: false });

    if (error) {
      toast.error(error.message);
    }

    // Only Draft versions can be overwritten - Active and Archived are read-only
    const availableVersions =
      data?.filter(({ status }) => status === "Draft") ?? [];

    setMakeMethods(
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
      setSelectedMakeMethod(availableVersions[0].id);
    }
  };

  useMount(() => {
    if (isJobMethod && routeData?.job.itemId) {
      getMakeMethods(routeData.job.itemId);
    }
  });

  return (
    <Fragment key={jobId}>
      {permissions.can("update", "production") &&
        (isJobMethod || isJobMakeMethod) && (
          <Menubar>
            <HStack className="w-full justify-start">
              <HStack spacing={0}>
                <MenubarItem
                  isLoading={isGetMethodLoading}
                  isDisabled={isDisabled || isGetMethodLoading}
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

                {configurableItemIds.length > 0 && isJobMethod && (
                  <MenubarItem
                    leftIcon={<LuSettings />}
                    isDisabled={
                      isDisabled ||
                      !permissions.can("update", "production") ||
                      isConfigureLoading
                    }
                    isLoading={isConfigureLoading}
                    onClick={() => {
                      setSelectedConfigureItemId(
                        routeData?.job?.itemId ?? null
                      );
                      configureSelectModal.onOpen();
                    }}
                  >
                    <Trans>Configure</Trans>
                  </MenubarItem>
                )}
                {itemLink && (
                  <MenubarItem leftIcon={<LuGitFork />} asChild>
                    <Link prefetch="intent" to={itemLink}>
                      <Trans>Item Master</Trans>
                    </Link>
                  </MenubarItem>
                )}
                {makeMethod &&
                  (makeMethod.requiresSerialTracking ||
                    makeMethod.requiresBatchTracking) && (
                    <PrintButton
                      sourceDocument="Operation"
                      sourceDocumentId={makeMethod.id}
                      locationId={routeData?.job?.locationId ?? undefined}
                      context="workCenter"
                      fileRoutes={{
                        pdf: path.to.file.operationLabelsPdf,
                        zpl: path.to.file.operationLabelsZpl
                      }}
                    />
                  )}
              </HStack>
            </HStack>
          </Menubar>
        )}
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
              action={path.to.jobMethodGet}
              validator={getJobMethodValidator}
              onSubmit={getMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>Get Method</Trans>
                </ModalTitle>
                <ModalDescription>
                  Overwrite the job method with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Tabs defaultValue="item" className="w-full">
                  {isJobMethod && (
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                      <TabsTrigger value="item">
                        <LuSquareStack className="mr-2" /> Item
                      </TabsTrigger>
                      <TabsTrigger value="quote">
                        <RiProgress4Line className="mr-2" />
                        <Trans>Quote</Trans>
                      </TabsTrigger>
                    </TabsList>
                  )}
                  <TabsContent value="item">
                    {isJobMethod ? (
                      <>
                        <Hidden name="type" value="item" />
                        <Hidden name="targetId" value={jobId} />
                      </>
                    ) : (
                      <>
                        <Hidden name="type" value="method" />
                        <Hidden name="targetId" value={methodId!} />
                      </>
                    )}

                    <VStack spacing={4}>
                      {hasMethods && (
                        <Alert variant="destructive">
                          <LuTriangleAlert className="h-4 w-4" />
                          <AlertTitle>
                            <Trans>
                              This will overwrite the existing job method
                            </Trans>
                          </AlertTitle>
                        </Alert>
                      )}
                      <Item
                        name="sourceId"
                        label={t`Source Method`}
                        type={(routeData?.job.itemType ?? "Part") as "Part"}
                        blacklist={configurableItemIds}
                        includeInactive={includeInactive === true}
                        locationId={routeData?.job?.locationId ?? undefined}
                        replenishmentSystem="Make"
                      />
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="include-inactive"
                          checked={includeInactive}
                          onCheckedChange={setIncludeInactive}
                        />
                        <label
                          htmlFor="include-inactive"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          <Trans>Include Inactive</Trans>
                        </label>
                      </div>

                      <AdvancedSection onChange={setHasMethodParts} />
                    </VStack>
                  </TabsContent>
                  <TabsContent value="quote">
                    <Hidden name="type" value="quoteLine" />
                    <Hidden name="targetId" value={jobId} />
                    <VStack spacing={4}>
                      <QuoteLineMethodForm />
                      <AdvancedSection onChange={setHasMethodParts} />
                    </VStack>
                  </TabsContent>
                </Tabs>
              </ModalBody>
              <ModalFooter>
                <Button onClick={getMethodModal.onClose} variant="secondary">
                  <Trans>Cancel</Trans>
                </Button>
                <Submit
                  isDisabled={!hasMethodParts}
                  variant={hasMethods ? "destructive" : "primary"}
                >
                  <Trans>Confirm</Trans>
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
              action={path.to.jobMethodSave}
              validator={getJobMethodValidator}
              defaultValues={{
                // @ts-expect-error
                itemId: isJobMethod
                  ? (routeData?.job?.itemId ?? undefined)
                  : undefined
              }}
              onSubmit={saveMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>
                  <Trans>Save Method</Trans>
                </ModalTitle>
                <ModalDescription>
                  Overwrite the target manufacturing method with the job method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                {isJobMethod ? (
                  <>
                    <Hidden name="type" value="job" />
                    <Hidden name="sourceId" value={jobId} />
                  </>
                ) : (
                  <>
                    <Hidden name="type" value="method" />
                    <Hidden name="sourceId" value={methodId!} />
                  </>
                )}

                <VStack spacing={4}>
                  <Alert variant="destructive">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      <Trans>
                        This will overwrite the existing manufacturing method
                        and the latest versions of all subassemblies.
                      </Trans>
                    </AlertTitle>
                  </Alert>
                  <Item
                    name="itemId"
                    label={t`Target Method`}
                    type={(routeData?.job?.itemType ?? "Part") as "Part"}
                    blacklist={configurableItemIds}
                    locationId={routeData?.job?.locationId ?? undefined}
                    onChange={(value) => {
                      if (value) {
                        getMakeMethods(value?.value);
                      } else {
                        setMakeMethods([]);
                        setSelectedMakeMethod(null);
                      }
                    }}
                    includeInactive={includeInactive === true}
                    replenishmentSystem="Make"
                  />
                  <SelectControlled
                    name="targetId"
                    options={makeMethods}
                    label={t`Version`}
                    value={selectedMakeMethod ?? undefined}
                    onChange={(value) => {
                      if (value) {
                        setSelectedMakeMethod(value?.value);
                      } else {
                        setSelectedMakeMethod(null);
                      }
                    }}
                    placeholder={
                      makeMethods.length === 0
                        ? t`No draft versions available`
                        : undefined
                    }
                  />
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="include-inactive"
                      checked={includeInactive}
                      onCheckedChange={setIncludeInactive}
                    />
                    <label
                      htmlFor="include-inactive"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      <Trans>Include Inactive</Trans>
                    </label>
                  </div>

                  <AdvancedSection onChange={setHasMethodParts} />
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={saveMethodModal.onClose} variant="secondary">
                  <Trans>Cancel</Trans>
                </Button>
                <Submit
                  variant={hasMethods ? "destructive" : "primary"}
                  isDisabled={
                    !selectedMakeMethod ||
                    !permissions.can("update", "parts") ||
                    !hasMethodParts
                  }
                >
                  <Trans>Confirm</Trans>
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
      {configureSelectModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) {
              configureSelectModal.onClose();
            }
          }}
        >
          <ModalContent>
            <ValidatedForm validator={getJobMethodValidator}>
              <ModalHeader>
                <ModalTitle>
                  <Trans>Configure Item</Trans>
                </ModalTitle>
                <ModalDescription>
                  <Trans>Select an item to configure</Trans>
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Item
                  name="sourceId"
                  label={t`Item`}
                  value={selectedConfigureItemId ?? undefined}
                  type={(routeData?.job?.itemType ?? "Part") as "Part"}
                  includeInactive={includeInactive === true}
                  whitelist={configurableItemIds}
                  locationId={routeData?.job?.locationId ?? undefined}
                  replenishmentSystem="Make"
                  onChange={(value) => {
                    setSelectedConfigureItemId(value?.value ?? null);
                  }}
                />
              </ModalBody>
              <ModalFooter>
                <Button
                  onClick={configureSelectModal.onClose}
                  variant="secondary"
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  isDisabled={!selectedConfigureItemId}
                  onClick={() =>
                    handleConfigureItemSelect(selectedConfigureItemId)
                  }
                >
                  <Trans>Next</Trans>
                </Button>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
      {configuratorModal.isOpen && (
        <ConfiguratorModal
          open
          destructive
          initialValues={
            routeData?.job?.configuration
              ? (routeData.job.configuration as Record<string, any>)
              : {}
          }
          groups={configurationParameters.groups}
          parameters={configurationParameters.parameters}
          onClose={() => {
            configuratorModal.onClose();
            setSelectedConfigureItemId(null);
            setConfigurationParameters({ groups: [], parameters: [] });
          }}
          onSubmit={(config: Record<string, any>) => {
            saveConfiguration(config);
          }}
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
          <Trans>Advanced</Trans>
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
              <Trans>Bill of Material</Trans>
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
              <Trans>Bill of Process</Trans>
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

export default JobMakeMethodTools;
