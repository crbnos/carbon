import { Array, ValidatedForm } from "@carbon/form";
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
import { useEffect, useState } from "react";
import type { z } from "zod";
import { TrackingTypeIcon } from "~/components";
import {
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  InputControlled,
  Select,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import MaterialDimension from "~/components/Form/MaterialDimension";
import MaterialFinish from "~/components/Form/MaterialFinish";
import MaterialGrade from "~/components/Form/MaterialGrade";
import MaterialType, { useMaterialTypes } from "~/components/Form/MaterialType";
import Shape, { useShape } from "~/components/Form/Shape";
import Substance, { useSubstance } from "~/components/Form/Substance";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import { getMaterialDescription, getMaterialId } from "~/utils/items";
import { path } from "~/utils/path";
import {
  itemTrackingTypes,
  materialValidator,
  materialValidatorWithGeneratedIds,
} from "../../items.models";

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

  const [materialId, setMaterialId] = useState(initialValues.id ?? "");
  const [description, setDescription] = useState(
    initialValues.description ?? ""
  );

  const [properties, setProperties] = useState<{
    substance?: string;
    substanceCode?: string;
    shape?: string;
    shapeCode?: string;
    grade?: string;
    dimensions?: string;
    finish?: string;
    materialType?: string;
    materialTypeCode?: string;
  }>({});
  const [substanceId, setSubstanceId] = useState<string | undefined>();
  const [formId, setFormId] = useState<string | undefined>();

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const materialTypes = useMaterialTypes(substanceId, formId);
  const substance = useSubstance();
  const shape = useShape();

  useEffect(() => {
    setMaterialId(getMaterialId(properties));
    setDescription(getMaterialDescription(properties));
  }, [properties]);

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
  const companySettings = useSettings();
  const useCustomId = companySettings.materialGeneratedIds === false;

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
            validator={
              useCustomId
                ? materialValidator
                : materialValidatorWithGeneratedIds
            }
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
              {!useCustomId && (
                <>
                  <Hidden name="id" value={materialId} />
                  <Hidden name="name" value={description} />
                </>
              )}
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4 items-start",
                  "grid-cols-1 md:grid-cols-2"
                )}
              >
                {useCustomId && (
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
                      substanceCode:
                        substance.find((s) => s.value === value?.value)?.code ??
                        "",
                    }));
                  }}
                />
                <MaterialGrade
                  name="gradeId"
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
                      shapeCode:
                        shape.find((s) => s.value === value?.value)?.code ?? "",
                    }));
                  }}
                />
                <MaterialType
                  name="materialTypeId"
                  label="Type"
                  substanceId={substanceId}
                  formId={formId}
                  onChange={(value) => {
                    const code = materialTypes.find(
                      (m) => m.value === value?.value
                    )?.code;
                    setProperties((prev) => ({
                      ...prev,
                      materialType: value?.label ?? "",
                      materialTypeCode: code,
                    }));
                  }}
                />
                <MaterialFinish
                  name="finishId"
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
                  name="dimensionId"
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

                <Array name="sizes" label="Sizes" />

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
