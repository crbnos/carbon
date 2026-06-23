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
  const { t } = useLingui();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const [type, setType] = useState<"Production" | "Scrap" | "Rework">(
    initialValues.type
  );

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
              {isEditing
                ? "Edit Production Quantity"
                : "Create Production Quantity"}
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
                options={[
                  { label: "Production", value: "Production" },
                  { label: "Scrap", value: "Scrap" },
                  { label: "Rework", value: "Rework" }
                ]}
                onChange={(value) =>
                  setType(value?.value as "Production" | "Scrap" | "Rework")
                }
              />
              {type === "Scrap" && (
                <ScrapReason
                  name="scrapReasonId"
                  label={t`Scrap Reason`}
                  termId="scrap"
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
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ProductionQuantityForm;
