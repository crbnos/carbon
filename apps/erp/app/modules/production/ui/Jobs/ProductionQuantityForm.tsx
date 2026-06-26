import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import {
  Employee,
  Hidden,
  Number,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import ScrapReason from "~/components/Form/ScrapReason";
import { usePermissions } from "~/hooks";
import { productionQuantityValidator } from "../../production.models";

type ProductionQuantityFormProps = {
  initialValues: z.infer<typeof productionQuantityValidator>;
  operationOptions?: {
    label: string;
    value: string;
    helperText?: string;
  }[];
};

const ProductionQuantityForm = ({
  initialValues,
  operationOptions
}: ProductionQuantityFormProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [type, setType] = useState<"Production" | "Scrap" | "Rework">(
    initialValues.type
  );

  const quantityTypeOptions = [
    { label: i18n._(msg`Production`), value: "Production" },
    { label: i18n._(msg`Scrap`), value: "Scrap" },
    { label: i18n._(msg`Rework`), value: "Rework" }
  ];

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={productionQuantityValidator}
          method="post"
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Production Quantity</Trans>
              ) : (
                <Trans>Create Production Quantity</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              {isEditing ? (
                <Hidden name="jobOperationId" />
              ) : (
                <Select
                  name="jobOperationId"
                  label={t`Operation`}
                  termId="operation"
                  options={operationOptions ?? []}
                />
              )}
              <Employee name="createdBy" label={t`Employee`} />
              <Number name="quantity" label={t`Quantity`} />
              <Select
                name="type"
                label={t`Quantity Type`}
                termId="production-quantity-type"
                options={quantityTypeOptions}
                onChange={(value) =>
                  setType(value?.value as "Production" | "Scrap" | "Rework")
                }
              />
              {type === "Scrap" && (
                <ScrapReason
                  name="scrapReasonId"
                  label={t`Scrap Reason`}
                  termId="production-quantity-scrap-reason"
                />
              )}
              <TextArea name="notes" label={t`Notes`} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ProductionQuantityForm;
