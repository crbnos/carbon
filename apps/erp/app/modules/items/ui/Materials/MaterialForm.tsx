import { ValidatedForm } from "@carbon/form";
import {
  cn,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast
} from "@carbon/react";
import { getMaterialDescription, getMaterialId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { TrackingTypeIcon } from "~/components";
import {
  Array,
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  InputControlled,
  ItemPostingGroup,
  Number,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure
} from "~/components/Form";
import MaterialDimension from "~/components/Form/MaterialDimension";
import MaterialFinish from "~/components/Form/MaterialFinish";
import MaterialGrade from "~/components/Form/MaterialGrade";
import MaterialType, { useMaterialTypes } from "~/components/Form/MaterialType";
import Shape, { useShape } from "~/components/Form/Shape";
import Substance, { useSubstance } from "~/components/Form/Substance";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import { path } from "~/utils/path";
import {
  itemTrackingTypes,
  materialValidator,
  materialValidatorWithGeneratedIds
} from "../../items.models";
import ItemStorageFields from "../Item/ItemStorageFields";

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
  onClose
}: MaterialFormProps) => {
  const { t } = useLingui();
  const [materialId, setMaterialId] = useState(initialValues.id ?? "");
  // Holds the auto-generated material short description (persisted to `name`),
  // composed from the selected substance/grade/shape/dimensions/finish/type.
  const [generatedName, setGeneratedName] = useState(initialValues.name ?? "");

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

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const materialTypes = useMaterialTypes(substanceId, formId);
  const substance = useSubstance();
  const shape = useShape();

  useEffect(() => {
    setMaterialId(getMaterialId(properties));
    setGeneratedName(getMaterialDescription(properties));
  }, [properties]);

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created material`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create material: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

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
    initialValues.defaultMethodType ?? "Purchase to Order"
  );

  const translateItemTrackingType = (v: string) =>
    v === "Inventory"
      ? t`Inventory`
      : v === "Non-Inventory"
        ? t`Non-Inventory`
        : v === "Serial"
          ? t`Serial`
          : t`Batch`;

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {translateItemTrackingType(itemTrackingType)}
      </span>
    ),
    value: itemTrackingType
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
              <ModalCardTitle>
                <Trans>New Material</Trans>
              </ModalCardTitle>
              <ModalCardDescription>
                <Trans>
                  A material is a physical item used to make a part that can be
                  used across multiple jobs
                </Trans>
              </ModalCardDescription>
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="replenishmentSystem" value="Buy" />
              {!useCustomId && (
                <>
                  <Hidden name="id" value={materialId} />
                  <Hidden name="name" value={generatedName} />
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
                      label={t`Material ID`}
                      helperText={
                        startsWithLetter(id)
                          ? t`Use ... to get the next material ID`
                          : undefined
                      }
                      value={id}
                      onChange={onIdChange}
                      isDisabled={loading}
                      isUppercase
                      autoFocus
                    />

                    <InputControlled
                      name="name"
                      label={t`Short Description`}
                      value={generatedName}
                      onChange={(value) => {
                        setGeneratedName(value ?? "");
                      }}
                    />
                  </>
                )}
                <Substance
                  name="materialSubstanceId"
                  label={t`Substance`}
                  onChange={(value) => {
                    setSubstanceId(value?.value as string | undefined);
                    setProperties((prev) => ({
                      ...prev,
                      substance: (value?.label as string) ?? "",
                      substanceCode:
                        substance.find((s) => s.value === value?.value)?.code ??
                        ""
                    }));
                  }}
                />
                <MaterialGrade
                  name="gradeId"
                  label={t`Grade`}
                  substanceId={substanceId}
                  onChange={(value) => {
                    setProperties((prev) => ({
                      ...prev,
                      grade: value?.name ?? ""
                    }));
                  }}
                />
                <Shape
                  name="materialFormId"
                  label={t`Shape`}
                  onChange={(value) => {
                    setFormId(value?.value as string | undefined);
                    setProperties((prev) => ({
                      ...prev,
                      shape: (value?.label as string) ?? "",
                      shapeCode:
                        shape.find((s) => s.value === value?.value)?.code ?? ""
                    }));
                  }}
                />
                <MaterialType
                  name="materialTypeId"
                  label={t`Type`}
                  substanceId={substanceId}
                  formId={formId}
                  onChange={(value) => {
                    const code = materialTypes.find(
                      (m) => m.value === value?.value
                    )?.code;
                    setProperties((prev) => ({
                      ...prev,
                      materialType: value?.label ?? "",
                      materialTypeCode: code
                    }));
                  }}
                />
                <MaterialFinish
                  name="finishId"
                  label={t`Finish`}
                  substanceId={substanceId}
                  onChange={(value) => {
                    setProperties((prev) => ({
                      ...prev,
                      finish: value?.name ?? ""
                    }));
                  }}
                />
                <MaterialDimension
                  name="dimensionId"
                  label={t`Dimensions`}
                  formId={formId}
                  onChange={(value) => {
                    setProperties((prev) => ({
                      ...prev,
                      dimensions: value?.name ?? ""
                    }));
                  }}
                />

                <Select
                  name="itemTrackingType"
                  label={t`Tracking Type`}
                  termId="tracked-entity"
                  options={itemTrackingTypeOptions}
                />

                <DefaultMethodType
                  name="defaultMethodType"
                  label={t`Default Method Type`}
                  termId="method-type"
                  replenishmentSystem="Buy"
                  value={defaultMethodType}
                  onChange={(newValue) =>
                    setDefaultMethodType(newValue?.value ?? "Buy")
                  }
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label={t`Inventory Unit of Measure`}
                />

                <Number
                  name="unitCost"
                  label={t`Unit Cost`}
                  formatOptions={{
                    style: "currency",
                    currency: baseCurrency
                  }}
                  minValue={0}
                />

                <ItemPostingGroup
                  name="postingGroupId"
                  label={t`Item Group`}
                  isClearable
                />
                <Array name="sizes" label={t`Sizes`} />

                <ItemStorageFields />

                <CustomFormFields table="material" tags={initialValues.tags} />
              </div>
              <div className="mt-4 w-full">
                <TextArea name="description" label={t`Long Description`} />
              </div>
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
                isLoading={fetcher.state !== "idle"}
                isDisabled={!permissions.can("create", "parts")}
              >
                <Trans>Save</Trans>
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default MaterialForm;
