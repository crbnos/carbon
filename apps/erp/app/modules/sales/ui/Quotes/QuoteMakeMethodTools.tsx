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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure,
  useMount,
  VStack,
} from "@carbon/react";
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
  LuSettings,
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
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import { getMethodValidator } from "../../sales.models";
import type { Quotation, QuotationLine, QuoteMethod } from "../../types";
import { QuoteLineMethodForm } from "./QuoteLineMethodForm";

const QuoteMakeMethodTools = () => {
  const permissions = usePermissions();
  const { quoteId, lineId, methodId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const fetcher = useFetcher<{ error: string | null }>();
  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    methods: Promise<Tree<QuoteMethod>[]> | Tree<QuoteMethod>[];
  }>(path.to.quote(quoteId));

  const materialRouteData = useRouteData<{
    makeMethod: { itemId: string; itemType: MethodItemType | null };
  }>(path.to.quoteLineMakeMethod(quoteId, lineId!, methodId!));

  const itemId =
    materialRouteData?.makeMethod?.itemId ??
    routeData?.lines.find((line) => line.id === lineId)?.itemId;
  const itemType =
    materialRouteData?.makeMethod?.itemType ??
    routeData?.lines.find((line) => line.id === lineId)?.itemType;

  const itemLink =
    itemType && itemId
      ? getLinkToItemDetails(itemType as MethodItemType, itemId)
      : null;

  const lineData = useRouteData<{
    configurationParameters: Promise<{
      groups: ConfigurationParameterGroup[];
      parameters: ConfigurationParameter[];
    }>;
  }>(path.to.quoteLineMethod(quoteId, lineId!, methodId!));

  const line = routeData?.lines.find((line) => line.id === lineId);
  const { pathname } = useLocation();

  const methodTree = Array.isArray(routeData?.methods)
    ? routeData?.methods.find((m) => m.data.quoteLineId === line?.id)
    : undefined;
  const hasMethods = methodTree?.children && methodTree.children.length > 0;

  const isGetMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.quoteMethodGet;
  const isSaveMethodLoading =
    fetcher.state !== "idle" && fetcher.formAction === path.to.quoteMethodSave;

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

  const isQuoteLineMethod =
    pathname === path.to.quoteLineMethod(quoteId, lineId!, methodId!);
  const isQuoteMakeMethod =
    methodId &&
    pathname === path.to.quoteLineMakeMethod(quoteId, lineId!, methodId);

  const { carbon } = useCarbon();

  const configuratorModal = useDisclosure();
  const [isConfigured, setIsConfigured] = useState(false);
  const getIsConfigured = async () => {
    if (isQuoteLineMethod && line?.itemId && carbon) {
      const { data, error } = await carbon
        .from("itemReplenishment")
        .select("requiresConfiguration")
        .eq("itemId", line.itemId)
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
      action: path.to.quoteLineConfigure(quoteId, lineId!),
      encType: "application/json",
    });
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
    if (isQuoteLineMethod && line?.itemId) {
      getMakeMethods(line.itemId);
    }
  });

  return (
    <>
      {line &&
        permissions.can("update", "sales") &&
        (isQuoteLineMethod || isQuoteMakeMethod) && (
          <Menubar>
            <HStack className="w-full justify-start">
              <HStack spacing={0}>
                <MenubarItem
                  isLoading={isGetMethodLoading}
                  isDisabled={isGetMethodLoading}
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
                {isConfigured && isQuoteLineMethod && (
                  <MenubarItem
                    leftIcon={<LuSettings />}
                    isDisabled={!permissions.can("update", "sales")}
                    isLoading={
                      fetcher.state !== "idle" &&
                      fetcher.formAction ===
                        path.to.quoteLineConfigure(quoteId, lineId!)
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
              action={path.to.quoteMethodGet}
              validator={getMethodValidator}
              onSubmit={async (data, e) => {
                if (e) {
                  e.preventDefault();
                  e.stopPropagation();
                }
                
                const sourceId = data.sourceId as string;
                const type = data.type as string;

                // Only check configuration for "item" and "method" types, not "quoteLine"
                if (sourceId && carbon && (type === "item" || type === "method")) {
                  // Store the form data for later use
                  setPendingGetMethodData(data);

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
                    fetcher.submit(data, {
                      method: "post",
                      action: path.to.quoteMethodGet,
                    });
                    getMethodModal.onClose();
                  }
                } else {
                  // No sourceId, no carbon, or type is "quoteLine" - proceed with normal submission
                  fetcher.submit(data, {
                    method: "post",
                    action: path.to.quoteMethodGet,
                  });
                  getMethodModal.onClose();
                }
              }}
            >
              <ModalHeader>
                <ModalTitle>Get Method</ModalTitle>
                <ModalDescription>
                  Overwrite the quote method with the source method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                {isQuoteLineMethod ? (
                  <Tabs defaultValue="item" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 my-4">
                      <TabsTrigger value="item">
                        <LuSquareStack className="mr-2" /> Item
                      </TabsTrigger>
                      <TabsTrigger value="quote">
                        <RiProgress4Line className="mr-2" />
                        Quote
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="item">
                      <Hidden name="type" value="item" />
                      <Hidden name="targetId" value={`${quoteId}:${lineId}`} />
                      <VStack spacing={4}>
                        <Item
                          name="sourceId"
                          label="Source Method"
                          type={(line?.itemType ?? "Part") as "Part"}
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
                              This will overwrite the existing quote method
                            </AlertTitle>
                          </Alert>
                        )}
                      </VStack>
                    </TabsContent>
                    <TabsContent value="quote">
                      <Hidden name="type" value="quoteLine" />
                      <Hidden name="targetId" value={`${quoteId}:${lineId}`} />
                      <QuoteLineMethodForm />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <>
                    <Hidden name="type" value="method" />
                    <Hidden name="targetId" value={methodId!} />
                    <VStack spacing={4}>
                      <Item
                        name="sourceId"
                        label="Source Method"
                        type={(line?.itemType ?? "Part") as "Part"}
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
                            This will overwrite the existing quote method
                          </AlertTitle>
                        </Alert>
                      )}
                    </VStack>
                  </>
                )}
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
              action={path.to.quoteMethodSave}
              validator={getMethodValidator}
              defaultValues={{
                sourceId: isQuoteLineMethod
                  ? line?.itemId ?? undefined
                  : undefined,
                // @ts-expect-error
                itemId: isQuoteLineMethod
                  ? line?.itemId ?? undefined
                  : undefined,
              }}
              onSubmit={saveMethodModal.onClose}
            >
              <ModalHeader>
                <ModalTitle>Save Method</ModalTitle>
                <ModalDescription>
                  Overwrite the target manufacturing method with the quote
                  method
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                {isQuoteLineMethod ? (
                  <>
                    <Hidden name="type" value="item" />
                    <Hidden name="sourceId" value={`${quoteId}:${lineId}`} />
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
                    type={(line?.itemType ?? "Part") as "Part"}
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
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button onClick={saveMethodModal.onClose} variant="secondary">
                  Cancel
                </Button>
                <Submit
                  isDisabled={!selectedMakeMethod}
                  variant={hasMethods ? "destructive" : "primary"}
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
                    action: path.to.quoteMethodGet,
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
            // Regular configurator for line configuration
            <Await resolve={lineData?.configurationParameters}>
              {(configurationParameters) => (
                <ConfiguratorModal
                  open
                  destructive
                  initialValues={
                    (line?.configuration || {}) as Record<string, any>
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

export default QuoteMakeMethodTools;
