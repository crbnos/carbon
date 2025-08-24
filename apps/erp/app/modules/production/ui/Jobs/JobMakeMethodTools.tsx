import { useCarbon } from "@carbon/auth";
import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Badge,
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
  SplitButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure,
  useMount,
  VStack,
} from "@carbon/react";
import { labelSizes } from "@carbon/utils";
import {
  Await,
  Link,
  useFetcher,
  useLocation,
  useParams,
} from "@remix-run/react";
import { Suspense, useEffect, useState } from "react";
import {
  LuGitBranch,
  LuGitFork,
  LuGitMerge,
  LuListChecks,
  LuQrCode,
  LuSquareStack,
  LuTriangleAlert,
} from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import { ConfiguratorModal } from "~/components/Configurator/ConfiguratorForm";
import { Hidden, Item, Submit } from "~/components/Form";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup,
} from "~/modules/items";
import { getConfigurationParameters } from "~/modules/items";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import MakeMethodVersionStatus from "~/modules/items/ui/Item/MakeMethodVersionStatus";
import { QuoteLineMethodForm } from "~/modules/sales/ui/Quotes/QuoteLineMethodForm";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { getJobMethodValidator } from "../../production.models";
import type { Job, JobMakeMethod, JobMethod } from "../../types";

const JobMakeMethodTools = ({ makeMethod }: { makeMethod?: JobMakeMethod }) => {
  const permissions = usePermissions();
  const { jobId, methodId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const fetcher = useFetcher<{ error: string | null }>();
  const routeData = useRouteData<{
    job: Job;
    method: Tree<JobMethod>;
    configurationParameters: Promise<{
      groups: ConfigurationParameterGroup[];
      parameters: ConfigurationParameter[];
    }>;
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
    fetcher.state !== "idle" && fetcher.formAction === path.to.jobMethodGet;
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

  const isJobMethod = pathname === path.to.jobMethod(jobId, methodId!);
  const isJobMakeMethod =
    methodId && pathname === path.to.jobMakeMethod(jobId, methodId);

  const { carbon } = useCarbon();

  const configuratorModal = useDisclosure();
  const [isConfigured, setIsConfigured] = useState(false);
  const getIsConfigured = async () => {
    if (isJobMethod && routeData?.job.itemId && carbon) {
      const { data, error } = await carbon
        .from("itemReplenishment")
        .select("requiresConfiguration")
        .eq("itemId", routeData.job.itemId)
        .single();

      if (error) {
        console.error(error);
      }

      setIsConfigured(data?.requiresConfiguration ?? false);
    }
  };

  useMount(() => {
    getIsConfigured();
  });

  const saveConfiguration = async (configuration: Record<string, any>) => {
    configuratorModal.onClose();
    fetcher.submit(JSON.stringify(configuration), {
      method: "post",
      action: path.to.jobConfigure(jobId),
      encType: "application/json",
    });
  };

  const navigateToTrackingLabels = (
    makeMethodId: string,
    zpl: boolean,
    {
      labelSize,
      trackedEntityId,
    }: { labelSize?: string; trackedEntityId?: string } = {}
  ) => {
    if (!window) return;
    if (!makeMethodId) return;

    if (zpl) {
      window.open(
        window.location.origin +
          path.to.file.operationLabelsZpl(makeMethodId, {
            labelSize,
          }),
        "_blank"
      );
    } else {
      window.open(
        window.location.origin +
          path.to.file.operationLabelsPdf(makeMethodId, {
            labelSize,
          }),
        "_blank"
      );
    }
  };

  const {
    company: { id: companyId },
  } = useUser();
  const [makeMethods, setMakeMethods] = useState<
    { label: JSX.Element; value: string }[]
  >([]);
  const [selectedMakeMethod, setSelectedMakeMethod] = useState<string | null>(
    null
  );
  const [sourceItemRequiresConfiguration, setSourceItemRequiresConfiguration] =
    useState(false);
  const [
    sourceItemConfigurationParameters,
    setSourceItemConfigurationParameters,
  ] = useState<{
    groups: ConfigurationParameterGroup[];
    parameters: ConfigurationParameter[];
  }>({ groups: [], parameters: [] });
  const [pendingGetMethodData, setPendingGetMethodData] = useState<any>(null);

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

    setMakeMethods(
      data?.map(({ id, version, status }) => ({
        label: (
          <div className="flex items-center gap-2">
            <Badge variant="outline">V{version}</Badge>{" "}
            <MakeMethodVersionStatus status={status} />
          </div>
        ),
        value: id,
      })) ?? []
    );

    if (data?.length === 1) {
      setSelectedMakeMethod(data[0].id);
    }
  };

  useMount(() => {
    if (isJobMethod && routeData?.job.itemId) {
      getMakeMethods(routeData.job.itemId);
    }
  });

  return (
    <>
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

                {isConfigured && isJobMethod && (
                  <MenubarItem
                    leftIcon={<LuGitMerge />}
                    isDisabled={
                      isDisabled || !permissions.can("update", "production")
                    }
                    isLoading={
                      fetcher.state !== "idle" &&
                      fetcher.formAction === path.to.jobConfigure(jobId)
                    }
                    onClick={() => {
                      configuratorModal.onOpen();
                    }}
                  >
                    Configure
                  </MenubarItem>
                )}
                {itemLink && (
                  <MenubarItem leftIcon={<LuGitFork />} asChild>
                    <Link prefetch="intent" to={itemLink}>
                      Item Master
                    </Link>
                  </MenubarItem>
                )}
                {makeMethod?.id && (
                  <MenubarItem leftIcon={<LuListChecks />} asChild>
                    <a
                      href={path.to.file.jobTraveler(makeMethod.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Job Traveler
                    </a>
                  </MenubarItem>
                )}
                {makeMethod &&
                  (makeMethod.requiresSerialTracking ||
                    makeMethod.requiresBatchTracking) && (
                    <SplitButton
                      dropdownItems={labelSizes.map((size) => ({
                        label: size.name,
                        onClick: () =>
                          navigateToTrackingLabels(makeMethod.id, !!size.zpl, {
                            labelSize: size.id,
                          }),
                      }))}
                      leftIcon={<LuQrCode />}
                      variant="ghost"
                      onClick={() =>
                        navigateToTrackingLabels(makeMethod.id, false)
                      }
                    >
                      Tracking Labels
                    </SplitButton>
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
              onSubmit={async (data, e) => {
                if (e) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                
                const sourceId = data.sourceId as string;
                // Get type from the form element since it's not in validated data
                const formElement = e?.target as HTMLFormElement;
                const formData = new FormData(formElement);
                const type = formData.get("type") as string;

                // Only check configuration for "item" and "method" types, not "quoteLine"
                if (sourceId && carbon && (type === "item" || type === "method")) {
                  // Store the form data for later use (include type which isn't in validated data)
                  setPendingGetMethodData({ ...data, type });

                  // Check if the source item requires configuration
                  const { data: replenishmentData } = await carbon
                    .from("itemReplenishment")
                    .select("requiresConfiguration, companyId")
                    .eq("itemId", sourceId)
                    .single();

                  if (replenishmentData?.requiresConfiguration) {
                    // Get configuration parameters for the source item
                    const companyId = replenishmentData?.companyId;
                    if (!companyId) {
                      toast.error("Unable to get company ID");
                      return;
                    }
                    const configParams = await getConfigurationParameters(
                      carbon,
                      sourceId,
                      companyId
                    );

                    setSourceItemRequiresConfiguration(true);
                    setSourceItemConfigurationParameters(configParams);
                    getMethodModal.onClose();
                    configuratorModal.onOpen();
                  } else {
                    // No configuration needed, proceed with normal submission
                    fetcher.submit({ ...data, type }, {
                      method: "post",
                      action: path.to.jobMethodGet,
                    });
                    getMethodModal.onClose();
                  }
                } else {
                  // No sourceId, no carbon, or type is "quoteLine" - proceed with normal submission
                  // Need to include type for jobs since it's not in validated data
                  const dataWithType = type ? { ...data, type } : data;
                  fetcher.submit(dataWithType, {
                    method: "post",
                    action: path.to.jobMethodGet,
                  });
                  getMethodModal.onClose();
                }
              }}
            >
              <ModalHeader>
                <ModalTitle>Get Method</ModalTitle>
                <ModalDescription>
                  Overwrite the job method with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Tabs defaultValue="item" className="w-full">
                  {isJobMethod && (
                    <TabsList className="grid w-full grid-cols-2 my-4">
                      <TabsTrigger value="item">
                        <LuSquareStack className="mr-2" /> Item
                      </TabsTrigger>
                      <TabsTrigger value="quote">
                        <RiProgress4Line className="mr-2" />
                        Quote
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
                      <Item
                        name="sourceId"
                        label="Source Method"
                        type={(routeData?.job.itemType ?? "Part") as "Part"}
                        includeInactive={includeInactive === true}
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
                          Include Inactive
                        </label>
                      </div>
                      {hasMethods && (
                        <Alert variant="destructive">
                          <LuTriangleAlert className="h-4 w-4" />
                          <AlertTitle>
                            This will overwrite the existing job method
                          </AlertTitle>
                        </Alert>
                      )}
                    </VStack>
                  </TabsContent>
                  <TabsContent value="quote">
                    <Hidden name="type" value="quoteLine" />
                    <Hidden name="targetId" value={jobId} />
                    <QuoteLineMethodForm />
                  </TabsContent>
                </Tabs>
              </ModalBody>
              <ModalFooter>
                <Button onClick={getMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit variant={hasMethods ? "destructive" : "primary"}>
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
              action={path.to.jobMethodSave}
              validator={getJobMethodValidator}
              defaultValues={{
                // @ts-expect-error
                itemId: isJobMethod
                  ? routeData?.job?.itemId ?? undefined
                  : undefined,
              }}
              onSubmit={saveMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Save Method</ModalTitle>
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
                      This will overwrite the existing manufacturing method and
                      the latest versions of all subassemblies.
                    </AlertTitle>
                  </Alert>
                  <Item
                    name="itemId"
                    label="Target Method"
                    type={(routeData?.job?.itemType ?? "Part") as "Part"}
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
                    label="Version"
                    value={selectedMakeMethod ?? undefined}
                    onChange={(value) => {
                      if (value) {
                        setSelectedMakeMethod(value?.value);
                      } else {
                        setSelectedMakeMethod(null);
                      }
                    }}
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
                      Include Inactive
                    </label>
                  </div>
                  {hasMethods && (
                    <Alert variant="destructive">
                      <LuTriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        This will overwrite the existing manufacturing method
                      </AlertTitle>
                    </Alert>
                  )}
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={saveMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit
                  variant={hasMethods ? "destructive" : "primary"}
                  isDisabled={
                    !selectedMakeMethod || !permissions.can("update", "parts")
                  }
                >
                  Confirm
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {configuratorModal.isOpen && (
        <Suspense fallback={null}>
          {sourceItemRequiresConfiguration ? (
            // Configurator for source item when getting method
            <ConfiguratorModal
              open
              destructive
              initialValues={{} as Record<string, any>}
              groups={sourceItemConfigurationParameters.groups}
              parameters={sourceItemConfigurationParameters.parameters}
              onClose={() => {
                configuratorModal.onClose();
                setSourceItemRequiresConfiguration(false);
                setSourceItemConfigurationParameters({
                  groups: [],
                  parameters: [],
                });
              }}
              onSubmit={(config: Record<string, any>) => {
                // Submit the get method with configuration
                if (pendingGetMethodData) {
                  const dataWithConfig = {
                    ...pendingGetMethodData,
                    configuration: JSON.stringify(config),
                  };

                  fetcher.submit(dataWithConfig, {
                    method: "post",
                    action: path.to.jobMethodGet,
                  });

                  setPendingGetMethodData(null);
                }

                configuratorModal.onClose();
                setSourceItemRequiresConfiguration(false);
                setSourceItemConfigurationParameters({
                  groups: [],
                  parameters: [],
                });
              }}
            />
          ) : (
            // Regular configurator for job configuration
            <Await resolve={routeData?.configurationParameters}>
              {(configurationParameters) => (
                <ConfiguratorModal
                  open
                  destructive
                  initialValues={
                    (routeData?.job.configuration || {}) as Record<string, any>
                  }
                  groups={configurationParameters?.groups ?? []}
                  parameters={configurationParameters?.parameters ?? []}
                  onClose={configuratorModal.onClose}
                  onSubmit={(config: Record<string, any>) => {
                    saveConfiguration(config);
                  }}
                />
              )}
            </Await>
          )}
        </Suspense>
      )}
    </>
  );
};

export default JobMakeMethodTools;
