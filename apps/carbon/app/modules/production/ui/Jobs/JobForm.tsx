import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack,
  cn,
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  CustomFormFields,
  Customer,
  DatePicker,
  Hidden,
  Input,
  InputControlled,
  Item,
  Location,
  NumberControlled,
  Select,
  SequenceOrCustomId,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { jobStatus } from "~/modules/production";
import { deadlineTypes, jobValidator } from "~/modules/production";
import { type MethodItemType } from "~/modules/shared";

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
  const { supabase } = useSupabase();
  const [type, setType] = useState<MethodItemType>(
    initialValues.itemType ?? "Part"
  );

  const [itemData, setItemData] = useState<{
    itemId: string;
    description: string;
    uom: string;
    quantity: number;
    scrapQuantity: number;
    scrapPercentage: number;
    modelUploadId: string | null;
  }>({
    itemId: initialValues.itemId ?? "",
    description: initialValues.description ?? "",
    quantity: initialValues.quantity ?? 0,
    scrapQuantity: initialValues.scrapQuantity ?? 0,
    scrapPercentage:
      (initialValues.quantity ?? 0) === 0
        ? 0
        : (initialValues.scrapQuantity ?? 0) / initialValues.scrapQuantity,
    uom: initialValues.unitOfMeasureCode ?? "",
    modelUploadId: initialValues.modelUploadId ?? null,
  });

  const isCustomer = permissions.is("customer");
  const isEditing = initialValues.id !== undefined;

  const onTypeChange = (t: MethodItemType) => {
    setType(t);
    setItemData({
      itemId: "",
      description: "",
      uom: "EA",
      quantity: 0,
      scrapPercentage: 0,
      scrapQuantity: 0,
      modelUploadId: null,
    });
  };

  const onItemChange = async (itemId: string) => {
    if (!itemId) return;
    if (!supabase || !company.id) return;
    const [item, manufacturing] = await Promise.all([
      supabase
        .from("item")
        .select(
          "name, readableId, defaultMethodType, unitOfMeasureCode, modelUploadId"
        )
        .eq("id", itemId)
        .eq("companyId", company.id)
        .single(),
      supabase
        .from("itemReplenishment")
        .select("lotSize, scrapPercentage")
        .eq("itemId", itemId)
        .single(),
    ]);

    setItemData({
      itemId,
      description: item.data?.name ?? "",
      uom: item.data?.unitOfMeasureCode ?? "EA",
      quantity: manufacturing?.data?.lotSize ?? 0,
      modelUploadId: item.data?.modelUploadId ?? null,
      scrapPercentage: manufacturing?.data?.scrapPercentage ?? 0,
      scrapQuantity: Math.ceil(
        (manufacturing?.data?.lotSize ?? 0) *
          ((manufacturing?.data?.scrapPercentage ?? 0) / 100)
      ),
    });
  };

  return (
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
              A job is a set of work to be done to fulfill an order or increase
              inventory
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden
            name="modelUploadId"
            value={itemData.modelUploadId ?? undefined}
          />
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-2"
              )}
            >
              {isEditing ? (
                <Input name="jobId" label="Job ID" isReadOnly />
              ) : (
                <SequenceOrCustomId name="jobId" label="Job ID" table="job" />
              )}

              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label="Customer"
                isOptional
              />

              {isEditing && <div className="col-span-1" />}

              <Item
                name="itemId"
                label={type}
                type={type}
                value={itemData.itemId}
                validItemTypes={["Part", "Fixture"]}
                onChange={(value) => {
                  onItemChange(value?.value as string);
                }}
                onTypeChange={onTypeChange}
              />
              {!isEditing && (
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  value={itemData.uom}
                  onChange={(value) => {
                    if (value?.value) {
                      setItemData((prev) => ({ ...prev, uom: value.value }));
                    }
                  }}
                />
              )}

              <InputControlled
                name="description"
                label="Description"
                value={itemData.description}
                isReadOnly
                className="col-span-2"
              />
              <NumberControlled
                name="quantity"
                label="Quantity"
                value={itemData.quantity}
                onChange={(value) =>
                  setItemData((prev) => ({
                    ...prev,
                    quantity: value,
                    scrapQuantity: Math.ceil(value * prev.scrapPercentage),
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
              {isEditing && (
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  value={itemData.uom}
                  onChange={(value) => {
                    if (value?.value) {
                      setItemData((prev) => ({ ...prev, uom: value.value }));
                    }
                  }}
                />
              )}

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
                  label: d,
                }))}
              />
              <Location name="locationId" label="Location" />
              <CustomFormFields table="job" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "production")
                : !permissions.can("create", "production")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default JobForm;
