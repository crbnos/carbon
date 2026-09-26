import { useCarbon } from "@carbon/auth";
import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { scrapAllowance } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuDiamond, LuLayers } from "react-icons/lu";
import type { z } from "zod";
import { ConfiguratorModal } from "~/components/Configurator/ConfiguratorForm";
import {
  Combobox,
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Item,
  Location,
  NumberControlled,
  Select,
  SelectControlled,
  SequenceOrCustomId,
  Submit
} from "~/components/Form";
import { itemTypeLabel } from "~/components/Form/itemTypeLabel";
import { usePermissions, useUser } from "~/hooks";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup
} from "~/modules/items/types";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { jobStatus } from "../../production.models";
import {
  bulkJobValidator,
  deadlineRequiresDueDate,
  deadlineTypes,
  isJobLocked,
  jobValidator
} from "../../production.models";
import { getDeadlineIcon } from "./Deadline";

type JobFormValues = z.infer<typeof jobValidator> & {
  description: string;
  status: (typeof jobStatus)[number];
  itemType: MethodItemType;
};

// Where the finished job goes. Only "inventory" is the default; the other two
// are Make to Asset and write fixedAssetClassId / fixedAssetId respectively.
type CompleteTo = "inventory" | "class" | "asset";

type JobFormProps = {
  initialValues: JobFormValues;
  /** Classes a job may complete to — a CIP class is never a target. */
  fixedAssetClasses?: { id: string; name: string }[];
  /** Assets still under construction that a job may sweep its cost onto. */
  underConstructionAssets?: {
    id: string;
    fixedAssetId: string;
    name: string;
  }[];
};

const JobForm = ({
  initialValues,
  fixedAssetClasses = [],
  underConstructionAssets = []
}: JobFormProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();
  const { company } = useUser();
  const { carbon } = useCarbon();
  const [type, setType] = useState<MethodItemType>(
    initialValues.itemType ?? "Item"
  );
  const [deadlineType, setDeadlineType] = useState<string>(
    initialValues.deadlineType ?? ""
  );
  const [bulkDeadlineType, setBulkDeadlineType] = useState<string>(
    initialValues.deadlineType ?? ""
  );
  const showDueDate = deadlineRequiresDueDate(deadlineType);
  const showBulkDueDate = deadlineRequiresDueDate(bulkDeadlineType);

  const isLocked = isJobLocked(initialValues.status);
  const isDisabled = isLocked;

  const bulkInitialValues = {
    ...initialValues,
    totalQuantity: initialValues.quantity ?? 0,
    quantityPerJob: initialValues.quantity ?? 1,
    scrapQuantityPerJob: initialValues.scrapQuantity ?? 0,
    dueDateOfFirstJob: initialValues.dueDate ?? "",
    dueDateOfLastJob: initialValues.dueDate ?? "",
    locationId: initialValues.locationId ?? "",
    customerId: initialValues.customerId ?? "",
    modelUploadId: initialValues.modelUploadId ?? "",
    configuration: initialValues.configuration ?? {}
  };

  const [itemData, setItemData] = useState<{
    itemId: string;
    description: string;
    uom: string;
    quantity: number;
    quantityPerJob: number;
    scrapQuantity: number;
    scrapPercentage: number;
    modelUploadId: string | null;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 0,
    quantityPerJob: initialValues.quantity ?? 1,
    scrapQuantity: initialValues.scrapQuantity ?? 0,
    scrapPercentage:
      (initialValues.quantity ?? 0) === 0
        ? 0
        : (initialValues.scrapQuantity ?? 0) / initialValues.quantity,
    uom: initialValues.unitOfMeasureCode ?? "",
    modelUploadId: initialValues.modelUploadId ?? null
  });

  const configurationDisclosure = useDisclosure();
  const [requiresConfiguration, setRequiresConfiguration] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [configurationParameters, setConfigurationParameters] = useState<{
    parameters: ConfigurationParameter[];
    groups: ConfigurationParameterGroup[];
  } | null>(null);
  const [configurationValues, setConfigurationValues] = useState<
    Record<string, any> | ""
  >("");

  const isCustomer = permissions.is("customer");
  const isEditing = initialValues.id !== undefined;

  // The completion target is chosen up front and frozen once the job is
  // released: the release gate has already vetted it, and materials may have
  // been issued against it.
  const [completeTo, setCompleteTo] = useState<CompleteTo>(
    initialValues.fixedAssetId
      ? "asset"
      : initialValues.fixedAssetClassId
        ? "class"
        : "inventory"
  );
  const [fixedAssetClassId, setFixedAssetClassId] = useState<string>(
    initialValues.fixedAssetClassId ?? ""
  );
  const [fixedAssetId, setFixedAssetId] = useState<string>(
    initialValues.fixedAssetId ?? ""
  );
  const canEditCompleteTo =
    initialValues.status === "Draft" || initialValues.status === "Planned";

  const onTypeChange = (t: MethodItemType | "Item") => {
    setType(t as MethodItemType);
    setItemData({
      itemId: "",
      description: "",
      uom: "EA",
      quantity: 1,
      quantityPerJob: 1,
      scrapPercentage: 0,
      scrapQuantity: 0,
      modelUploadId: null
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!itemId) return;
    if (!carbon || !company.id) return;
    const [item, manufacturing] = await Promise.all([
      carbon
        .from("item")
        .select(
          "name, readableIdWithRevision, defaultMethodType, type, unitOfMeasureCode, modelUploadId"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      carbon
        .from("itemReplenishment")
        .select("lotSize, leadTime, scrapPercentage, requiresConfiguration")
        .eq("itemId", itemId)
        .single()
    ]);

    setItemData((current) => ({
      itemId,
      description: item.data?.name ?? "",
      uom: item.data?.unitOfMeasureCode ?? "EA",
      quantity:
        (manufacturing?.data?.lotSize ?? 0) === 0
          ? current.quantity
          : (manufacturing?.data?.lotSize ?? 0),
      quantityPerJob:
        (manufacturing?.data?.lotSize ?? 0) === 0
          ? current.quantityPerJob
          : (manufacturing?.data?.lotSize ?? 0),
      modelUploadId: item.data?.modelUploadId ?? null,
      scrapPercentage: manufacturing?.data?.scrapPercentage ?? 0,
      scrapQuantity: scrapAllowance(
        manufacturing?.data?.lotSize ?? 0,
        manufacturing?.data?.scrapPercentage ?? 0
      )
    }));

    if (item.data?.type) {
      setType(item.data.type as MethodItemType);
    }

    if (manufacturing.data?.requiresConfiguration) {
      setRequiresConfiguration(true);
      const [parameters, groups] = await Promise.all([
        carbon
          .from("configurationParameter")
          .select("*")
          .eq("itemId", itemId)
          .eq("companyId", company.id),
        carbon
          .from("configurationParameterGroup")
          .select("*")
          .eq("itemId", itemId)
          .eq("companyId", company.id)
      ]);

      if (parameters.error || groups.error) {
        toast.error(t`Failed to load configuration parameters`);
        return;
      }

      setConfigurationParameters({
        parameters: parameters.data ?? [],
        groups: groups.data ?? []
      });
    } else {
      setRequiresConfiguration(false);
      setConfigurationParameters(null);
    }
  };

  return (
    <>
      <Tabs defaultValue="job">
        <VStack className="w-full items-center relative">
          {!isEditing && (
            <TabsList className="absolute top-6 right-4 z-50">
              <TabsTrigger value="job">
                <LuDiamond className="mr-1" />
                Single Job
              </TabsTrigger>
              <TabsTrigger value="bulk">
                <LuLayers className="mr-1" />
                Many Jobs
              </TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="job" className="w-full">
            <Card>
              <ValidatedForm
                method="post"
                validator={jobValidator}
                defaultValues={initialValues}
                isDisabled={isEditing && isLocked}
              >
                <CardHeader>
                  <CardTitle>{isEditing ? "Job" : "New Job"}</CardTitle>
                  {!isEditing && (
                    <CardDescription>
                      A job is a set of work to be done to fulfill an order or
                      increase inventory
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <Hidden name="id" />
                  <Hidden
                    name="modelUploadId"
                    value={itemData.modelUploadId ?? undefined}
                  />
                  <Hidden name="unitOfMeasureCode" value={itemData.uom} />
                  {!isEditing && requiresConfiguration && (
                    <Hidden
                      name="configuration"
                      value={JSON.stringify(configurationValues)}
                    />
                  )}
                  {/* Only the chosen target is submitted; the other is cleared
                      so the two never both land on the row. */}
                  <Hidden
                    name="fixedAssetClassId"
                    value={completeTo === "class" ? fixedAssetClassId : ""}
                  />
                  <Hidden
                    name="fixedAssetId"
                    value={completeTo === "asset" ? fixedAssetId : ""}
                  />
                  <VStack>
                    <div
                      className={cn(
                        "grid w-full gap-x-8 gap-y-4",
                        isEditing
                          ? "grid-cols-1 lg:grid-cols-3"
                          : "grid-cols-1 md:grid-cols-2"
                      )}
                    >
                      {isEditing ? (
                        <Input name="jobId" label={t`Job ID`} isReadOnly />
                      ) : (
                        <SequenceOrCustomId
                          name="jobId"
                          label={t`Job ID`}
                          table="job"
                        />
                      )}

                      <Item
                        name="itemId"
                        label={i18n._(itemTypeLabel(type))}
                        type={type}
                        value={itemData.itemId}
                        locationId={initialValues.locationId ?? undefined}
                        validItemTypes={["Part", "Tool"]}
                        replenishmentSystem="Make"
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                        onTypeChange={onTypeChange}
                      />

                      {isEditing && (
                        <InputControlled
                          name="description"
                          label={t`Short Description`}
                          value={itemData.description}
                          isReadOnly
                        />
                      )}

                      <NumberControlled
                        name="quantity"
                        label={t`Quantity`}
                        value={itemData.quantity}
                        onChange={(value) =>
                          setItemData((prev) => ({
                            ...prev,
                            quantity: value,
                            scrapQuantity: scrapAllowance(
                              value,
                              prev.scrapPercentage
                            )
                          }))
                        }
                        minValue={0}
                      />
                      <NumberControlled
                        name="scrapQuantity"
                        label={t`Estimated Scrap Quantity`}
                        termId="job-estimated-scrap-quantity"
                        value={itemData.scrapQuantity}
                        onChange={(value) =>
                          setItemData((prev) => ({
                            ...prev,
                            scrapQuantity: value,
                            scrapPercentage:
                              prev.quantity > 0 ? value / prev.quantity : 1
                          }))
                        }
                        minValue={0}
                      />

                      <Location name="locationId" label={t`Location`} />

                      <SelectControlled
                        name="completeTo"
                        label={t`Complete To`}
                        value={completeTo}
                        onChange={(option) =>
                          setCompleteTo(
                            (option?.value as CompleteTo | undefined) ??
                              "inventory"
                          )
                        }
                        options={[
                          { value: "inventory", label: t`Inventory` },
                          { value: "class", label: t`Fixed Asset Class` },
                          { value: "asset", label: t`Asset Under Construction` }
                        ]}
                        isDisabled={!canEditCompleteTo}
                      />

                      {completeTo === "class" && (
                        <SelectControlled
                          name="fixedAssetClassSelect"
                          label={t`Fixed Asset Class`}
                          value={fixedAssetClassId}
                          onChange={(option) =>
                            setFixedAssetClassId(option?.value ?? "")
                          }
                          options={fixedAssetClasses.map((assetClass) => ({
                            value: assetClass.id,
                            label: assetClass.name
                          }))}
                          isDisabled={!canEditCompleteTo}
                        />
                      )}

                      {completeTo === "asset" && (
                        <Combobox
                          name="fixedAssetSelect"
                          label={t`Asset Under Construction`}
                          value={fixedAssetId}
                          onChange={(option) =>
                            setFixedAssetId(option?.value ?? "")
                          }
                          options={underConstructionAssets.map((asset) => ({
                            value: asset.id,
                            label: `${asset.fixedAssetId} — ${asset.name}`
                          }))}
                          isReadOnly={!canEditCompleteTo}
                        />
                      )}

                      {showDueDate && (
                        <DatePicker
                          name="dueDate"
                          label={t`Due Date`}
                          isDisabled={isCustomer}
                        />
                      )}
                      <Select
                        name="deadlineType"
                        label={t`Deadline Type`}
                        termId="job-deadline-type"
                        onChange={(option) =>
                          setDeadlineType(option?.value ?? "")
                        }
                        options={deadlineTypes.map((d) => ({
                          value: d,
                          label: (
                            <div className="flex gap-1 items-center">
                              {getDeadlineIcon(d)}
                              <span>{d}</span>
                            </div>
                          )
                        }))}
                      />

                      {isEditing && (
                        <Customer
                          name="customerId"
                          label={t`Customer`}
                          isOptional
                        />
                      )}

                      <CustomFormFields table="job" />
                    </div>
                  </VStack>
                </CardContent>
                <CardFooter>
                  {!isEditing && requiresConfiguration && (
                    <Button
                      type="button"
                      variant={isConfigured ? "secondary" : "primary"}
                      onClick={() => {
                        configurationDisclosure.onOpen();
                      }}
                    >
                      Configure
                    </Button>
                  )}
                  <Submit
                    isDisabled={
                      (requiresConfiguration && !isConfigured) ||
                      isDisabled ||
                      (isEditing
                        ? !permissions.can("update", "production")
                        : !permissions.can("create", "production"))
                    }
                  >
                    Save
                  </Submit>
                </CardFooter>
              </ValidatedForm>
            </Card>
          </TabsContent>
          {!isEditing && (
            <TabsContent value="bulk" className="w-full">
              <Card>
                <ValidatedForm
                  method="post"
                  action={path.to.newBulkJob}
                  validator={bulkJobValidator}
                  defaultValues={bulkInitialValues}
                >
                  <CardHeader>
                    <CardTitle>
                      <Trans>Bulk Jobs</Trans>
                    </CardTitle>
                    <CardDescription>
                      The bulk jobs form creates multiple jobs for the same item
                      across multiple due dates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Hidden name="id" />
                    <Hidden
                      name="modelUploadId"
                      value={itemData.modelUploadId ?? undefined}
                    />
                    <Hidden name="unitOfMeasureCode" value={itemData.uom} />
                    {!isEditing && requiresConfiguration && (
                      <Hidden
                        name="configuration"
                        value={JSON.stringify(configurationValues)}
                      />
                    )}
                    <VStack>
                      <div
                        className={cn(
                          "grid w-full gap-x-8 gap-y-4",
                          "grid-cols-1 md:grid-cols-2"
                        )}
                      >
                        <Item
                          name="itemId"
                          label={i18n._(itemTypeLabel(type))}
                          type={type}
                          value={itemData.itemId}
                          locationId={initialValues.locationId ?? undefined}
                          validItemTypes={["Part", "Tool"]}
                          onChange={(value) => {
                            onItemChange(value?.value as string);
                          }}
                          onTypeChange={onTypeChange}
                        />

                        <NumberControlled
                          name="totalQuantity"
                          label={t`Total Quantity`}
                          termId="job-bulk-total-quantity"
                          value={itemData.quantity}
                          onChange={(value) =>
                            setItemData((prev) => ({
                              ...prev,
                              quantity: value
                            }))
                          }
                          minValue={0}
                        />

                        <NumberControlled
                          name="quantityPerJob"
                          label={t`Quantity Per Job`}
                          termId="job-bulk-quantity-per-job"
                          value={itemData.quantityPerJob}
                          onChange={(value) =>
                            setItemData((prev) => ({
                              ...prev,
                              quantityPerJob: value
                            }))
                          }
                          minValue={0}
                        />

                        <NumberControlled
                          name="scrapQuantityPerJob"
                          label={t`Scrap Quantity Per Job`}
                          termId="job-bulk-scrap-quantity-per-job"
                          value={itemData.scrapQuantity}
                          onChange={(value) =>
                            setItemData((prev) => ({
                              ...prev,
                              scrapQuantity: value
                            }))
                          }
                          minValue={0}
                        />

                        {showBulkDueDate && (
                          <>
                            <DatePicker
                              name="dueDateOfFirstJob"
                              label={t`Due Date of First Job`}
                              termId="job-bulk-due-date-first"
                              isDisabled={isCustomer}
                            />

                            <DatePicker
                              name="dueDateOfLastJob"
                              label={t`Due Date of Last Job`}
                              termId="job-bulk-due-date-last"
                              isDisabled={isCustomer}
                            />
                          </>
                        )}

                        <Location name="locationId" label={t`Location`} />
                        <Select
                          name="deadlineType"
                          label={t`Deadline Type`}
                          termId="job-deadline-type"
                          onChange={(option) =>
                            setBulkDeadlineType(option?.value ?? "")
                          }
                          options={deadlineTypes.map((d) => ({
                            value: d,
                            label: (
                              <div className="flex gap-1 items-center">
                                {getDeadlineIcon(d)}
                                <span>{d}</span>
                              </div>
                            )
                          }))}
                        />

                        <CustomFormFields table="job" />
                      </div>
                    </VStack>
                  </CardContent>
                  <CardFooter>
                    {!isEditing && requiresConfiguration && (
                      <Button
                        type="button"
                        variant={isConfigured ? "secondary" : "primary"}
                        onClick={() => {
                          configurationDisclosure.onOpen();
                        }}
                      >
                        Configure
                      </Button>
                    )}
                    <Submit
                      isDisabled={
                        (requiresConfiguration && !isConfigured) ||
                        isDisabled ||
                        !permissions.can("create", "production")
                      }
                      withBlocker={false}
                    >
                      Save
                    </Submit>
                  </CardFooter>
                </ValidatedForm>
              </Card>
            </TabsContent>
          )}
        </VStack>
      </Tabs>

      {requiresConfiguration &&
        configurationDisclosure.isOpen &&
        configurationParameters && (
          <ConfiguratorModal
            open
            initialValues={configurationValues || {}}
            groups={configurationParameters.groups ?? []}
            parameters={configurationParameters.parameters ?? []}
            onClose={configurationDisclosure.onClose}
            onSubmit={(config: Record<string, any>) => {
              setConfigurationValues(config);
              setIsConfigured(true);
              configurationDisclosure.onClose();
            }}
          />
        )}
    </>
  );
};

export default JobForm;
