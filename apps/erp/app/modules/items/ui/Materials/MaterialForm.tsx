import { ValidatedForm } from "@carbon/form";
import {
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  cn,
  toast,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { TrackingTypeIcon } from "~/components";
import {
  Boolean,
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  InputControlled,
  Number,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import MaterialDimension from "~/components/Form/MaterialDimension";
import MaterialFinish from "~/components/Form/MaterialFinish";
import MaterialGrade from "~/components/Form/MaterialGrade";
import Shape from "~/components/Form/Shape";
import Substance from "~/components/Form/Substance";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { itemTrackingTypes, materialValidator } from "../../items.models";

type MaterialFormProps = {
  initialValues: z.infer<typeof materialValidator> & { tags?: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const MaterialForm = ({
  initialValues,
  type = "card",
  onClose,
}: MaterialFormProps) => {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode;

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const [materialId, setMaterialId] = useState(initialValues.id ?? "");
  const [description, setDescription] = useState(
    initialValues.description ?? ""
  );

  const [properties, setProperties] = useState<{
    substance?: string;
    shape?: string;
    grade?: string;
    dimensions?: string;
    finish?: string;
  }>({});
  const [substanceId, setSubstanceId] = useState<string | undefined>();
  const [formId, setFormId] = useState<string | undefined>();

  // const getMaterialFamily = useCallback(() => {
  //   const base = [
  //     properties.substance,
  //     properties.grade,
  //     properties.shape,
  //     properties.finish,
  //   ]
  //     .filter((p) => !!p)
  //     .join(" ");

  //   return base.toUpperCase();
  // }, [properties]);

  const getDescription = useCallback(() => {
    const base = [
      properties.substance,
      properties.grade,
      properties.shape,
      properties.finish,
    ]
      .filter((p) => !!p)
      .join(" ");

    if (properties.dimensions) {
      return `${base}: ${properties.dimensions}`;
    }

    return base;
  }, [properties]);

  useEffect(() => {
    // const materialFamily = getMaterialFamily();
    const d = getDescription();
    setDescription(d);
    setMaterialId(d.toUpperCase());
  }, [getDescription]);

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created material`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create material: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { id, onIdChange, loading } = useNextItemId("Material");

  useEffect(() => {
    if (id) {
      setMaterialId(id);
    }
  }, [id]);

  const permissions = usePermissions();
  const [withCustomId, setWithCustomId] = useState(false);

  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Buy"
  );

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {itemTrackingType}
      </span>
    ),
    value: itemTrackingType,
  }));

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={path.to.newMaterial}
            method="post"
            validator={materialValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>New Material</ModalCardTitle>
              <ModalCardDescription>
                A material is a physical item used to make a part that can be
                used across multiple jobs
              </ModalCardDescription>
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="replenishmentSystem" value="Buy" />
              {!withCustomId && (
                <>
                  <Hidden name="id" value={materialId} />
                  <Hidden name="name" value={description} />
                </>
              )}
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  "grid-cols-1 md:grid-cols-2"
                )}
              >
                {withCustomId && (
                  <>
                    <InputControlled
                      name="id"
                      label="Material ID"
                      value={materialId}
                      onChange={onIdChange}
                      isDisabled={loading}
                      isUppercase
                      autoFocus
                    />

                    <InputControlled
                      name="name"
                      label="Short Description"
                      value={description}
                      onChange={(value) => {
                        setDescription(value ?? "");
                      }}
                    />
                  </>
                )}
                <Substance
                  name="materialSubstanceId"
                  label="Substance"
                  onChange={(value) => {
                    setSubstanceId(value?.value as string | undefined);
                    setProperties((prev) => ({
                      ...prev,
                      substance: (value?.label as string) ?? "",
                    }));
                  }}
                />
                <MaterialGrade
                  name="grade"
                  label="Grade"
                  substanceId={substanceId}
                  onChange={(value) => {
                    setProperties((prev) => ({
                      ...prev,
                      grade: value?.name ?? "",
                    }));
                  }}
                />
                <Shape
                  name="materialFormId"
                  label="Shape"
                  onChange={(value) => {
                    setFormId(value?.value as string | undefined);
                    setProperties((prev) => ({
                      ...prev,
                      shape: (value?.label as string) ?? "",
                    }));
                  }}
                />
                <MaterialFinish
                  name="finish"
                  label="Finish"
                  substanceId={substanceId}
                  onChange={(value) => {
                    setProperties((prev) => ({
                      ...prev,
                      finish: value?.name ?? "",
                    }));
                  }}
                />
                <MaterialDimension
                  name="dimensions"
                  label="Dimensions"
                  formId={formId}
                  onChange={(value) => {
                    setProperties((prev) => ({
                      ...prev,
                      dimensions: value?.name ?? "",
                    }));
                  }}
                />

                <Select
                  name="itemTrackingType"
                  label="Tracking Type"
                  options={itemTrackingTypeOptions}
                />

                <DefaultMethodType
                  name="defaultMethodType"
                  label="Default Method Type"
                  replenishmentSystem="Buy"
                  value={defaultMethodType}
                  onChange={(newValue) =>
                    setDefaultMethodType(newValue?.value ?? "Buy")
                  }
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Inventory Unit of Measure"
                />

                <Number
                  name="unitCost"
                  label="Unit Cost"
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency,
                  }}
                  minValue={0}
                />
                <Boolean name="active" label="Active" />
                <CustomFormFields table="material" tags={initialValues.tags} />
              </div>
            </ModalCardBody>
            <ModalCardFooter>
              <Submit isDisabled={!permissions.can("create", "parts")}>
                Save
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default MaterialForm;
