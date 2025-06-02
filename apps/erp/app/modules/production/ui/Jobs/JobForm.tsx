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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack,
  cn,
  toast,
  useDisclosure,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import { ConfiguratorModal } from "~/components/Configurator/ConfiguratorForm";
import {
  CustomFormFields,
  Customer,
  DatePicker,
  Hidden,
  Input,
  Item,
  Location,
  NumberControlled,
  Select,
  SequenceOrCustomId,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import type {
  ConfigurationParameter,
  ConfigurationParameterGroup,
} from "~/modules/items/types";
import { type MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { jobStatus } from "../../production.models";
import {
  bulkJobValidator,
  deadlineTypes,
  jobValidator,
} from "../../production.models";
import { getDeadlineIcon, getDeadlineText } from "./Deadline";

type JobFormValues = z.infer<typeof jobValidator> & {
  description: string;
  status: (typeof jobStatus)[number];
  itemType: MethodItemType;
};

type JobFormProps = {
  initialValues: JobFormValues;
};

const JobForm = ({ initialValues }: JobFormProps) => {
  const permissions = usePermissions();
  const { company } = useUser();
  const { carbon } = useCarbon();
  const [type, setType] = useState<MethodItemType>(
    initialValues.itemType ?? "Item"
  );

  const isDisabled = ["Completed", "Cancelled"].includes(
    initialValues.status ?? ""
  );

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
    configuration: initialValues.configuration ?? {},
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
        : (initialValues.scrapQuantity ?? 0) / initialValues.scrapQuantity,
    uom: initialValues.unitOfMeasureCode ?? "",
    modelUploadId: initialValues.modelUploadId ?? null,
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
      modelUploadId: null,
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!itemId) return;
    if (!carbon || !company.id) return;
    const [item, manufacturing, itemReplenishment] = await Promise.all([
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
        .select("lotSize, scrapPercentage, requiresConfiguration")
        .eq("itemId", itemId)
        .single(),
      carbon
        .from("itemReplenishment")
        .select("requiresConfiguration")
        .eq("itemId", itemId)
        .maybeSingle(),
    ]);

    setItemData((current) => ({
      itemId,
      description: item.data?.name ?? "",
      uom: item.data?.unitOfMeasureCode ?? "EA",
      quantity:
        (manufacturing?.data?.lotSize ?? 0) === 0
          ? current.quantity
          : manufacturing?.data?.lotSize ?? 0,
      quantityPerJob:
        (manufacturing?.data?.lotSize ?? 0) === 0
          ? current.quantityPerJob
          : manufacturing?.data?.lotSize ?? 0,
      modelUploadId: item.data?.modelUploadId ?? null,
      scrapPercentage: manufacturing?.data?.scrapPercentage ?? 0,
      scrapQuantity: Math.ceil(
        (manufacturing?.data?.lotSize ?? 0) *
          ((manufacturing?.data?.scrapPercentage ?? 0) / 100)
      ),
    }));

    if (item.data?.type) {
      setType(item.data.type as MethodItemType);
    }

    if (itemReplenishment.data?.requiresConfiguration) {
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
          .eq("companyId", company.id),
      ]);

      if (parameters.error || groups.error) {
        toast.error("Failed to load configuration parameters");
        return;
      }

      setConfigurationParameters({
        parameters: parameters.data ?? [],
        groups: groups.data ?? [],
      });
    } else {
      setRequiresConfiguration(false);
      setConfigurationParameters(null);
    }
  };

  return (
    <>
      <Tabs defaultValue="job">
        <VStack className="w-full items-center">
          {!isEditing && (
            <TabsList className="bg-background/30">
              <TabsTrigger value="job">Single Job</TabsTrigger>
              <TabsTrigger value="bulk">Many Jobs</TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="job" className="w-full">
            <Card>
              <ValidatedForm
                method="post"
                validator={jobValidator}
                defaultValues={initialValues}
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
                        isEditing
                          ? "grid-cols-1 lg:grid-cols-3"
                          : "grid-cols-1 md:grid-cols-2"
                      )}
                    >
                      {isEditing ? (
                        <Input name="jobId" label="Job ID" isReadOnly />
                      ) : (
                        <SequenceOrCustomId
                          name="jobId"
                          label="Job ID"
                          table="job"
                        />
                      )}

                      <Item
                        name="itemId"
                        label={type}
                        type={type}
                        value={itemData.itemId}
                        validItemTypes={["Part", "Tool"]}
                        onChange={(value) => {
                          onItemChange(value?.value as string);
                        }}
                        onTypeChange={onTypeChange}
                      />

                      {isEditing && (
                        <InputControlled
                          name="description"
                          label="Short Description"
                          value={itemData.description}
                          isReadOnly
                        />
                      )}

                      <NumberControlled
                        name="quantity"
                        label="Quantity"
                        value={itemData.quantity}
                        onChange={(value) =>
                          setItemData((prev) => ({
                            ...prev,
                            quantity: value,
                            scrapQuantity: Math.ceil(
                              value * prev.scrapPercentage
                            ),
                          }))
                        }
                        minValue={0}
                      />
                      <NumberControlled
                        name="scrapQuantity"
                        label="Scrap Quantity"
                        value={itemData.scrapQuantity}
                        onChange={(value) =>
                          setItemData((prev) => ({
                            ...prev,
                            scrapQuantity: value,
                            scrapPercentage:
                              prev.quantity > 0 ? value / prev.quantity : 1,
                          }))
                        }
                        minValue={0}
                      />

                      <UnitOfMeasure
                        name="unitOfMeasureCode"
                        value={itemData.uom}
                        onChange={(value) => {
                          if (value?.value) {
                            setItemData((prev) => ({
                              ...prev,
                              uom: value.value,
                            }));
                          }
                        }}
                      />
                      <Location name="locationId" label="Location" />

                      <DatePicker
                        name="dueDate"
                        label="Due Date"
                        isDisabled={isCustomer}
                      />
                      <Select
                        name="deadlineType"
                        label="Deadline Type"
                        options={deadlineTypes.map((d) => ({
                          value: d,
                          label: (
                            <div className="flex gap-1 items-center">
                              {getDeadlineIcon(d, false)}
                              <span>{getDeadlineText(d)}</span>
                            </div>
                          ),
                        }))}
                      />

                      {isEditing && (
                        <Customer
                          name="customerId"
                          label="Customer"
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
                    <CardTitle>Bulk Jobs</CardTitle>
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
                          label={type}
                          type={type}
                          value={itemData.itemId}
                          validItemTypes={["Part", "Tool"]}
                          onChange={(value) => {
                            onItemChange(value?.value as string);
                          }}
                          onTypeChange={onTypeChange}
                        />

                        <NumberControlled
                          name="totalQuantity"
                          label="Total Quantity"
                          value={itemData.quantity}
                          onChange={(value) =>
                            setItemData((prev) => ({
                              ...prev,
                              quantity: value,
                            }))
                          }
                          minValue={0}
                        />

                        <NumberControlled
                          name="quantityPerJob"
                          label="Quantity Per Job"
                          value={itemData.quantityPerJob}
                          onChange={(value) =>
                            setItemData((prev) => ({
                              ...prev,
                              quantityPerJob: value,
                            }))
                          }
                          minValue={0}
                        />

                        <NumberControlled
                          name="scrapQuantityPerJob"
                          label="Scrap Quantity Per Job"
                          value={itemData.scrapQuantity}
                          onChange={(value) =>
                            setItemData((prev) => ({
                              ...prev,
                              scrapQuantity: value,
                            }))
                          }
                          minValue={0}
                        />

                        <UnitOfMeasure
                          name="unitOfMeasureCode"
                          value={itemData.uom}
                          onChange={(value) => {
                            if (value?.value) {
                              setItemData((prev) => ({
                                ...prev,
                                uom: value.value,
                              }));
                            }
                          }}
                        />
                        <Location name="locationId" label="Location" />

                        <DatePicker
                          name="dueDateOfFirstJob"
                          label="Due Date of First Job"
                          isDisabled={isCustomer}
                        />

                        <DatePicker
                          name="dueDateOfLastJob"
                          label="Due Date of Last Job"
                          isDisabled={isCustomer}
                        />

                        <Select
                          name="deadlineType"
                          label="Deadline Type"
                          options={deadlineTypes.map((d) => ({
                            value: d,
                            label: (
                              <div className="flex gap-1 items-center">
                                {getDeadlineIcon(d, false)}
                                <span>{getDeadlineText(d)}</span>
                              </div>
                            ),
                          }))}
                        />

                        <Customer
                          name="customerId"
                          label="Customer"
                          isOptional
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
