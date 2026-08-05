import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Hidden, Item, Number, Submit } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { cutListLineValidator } from "../../production.models";

type CutListLineFormProps = {
  initialValues: z.infer<typeof cutListLineValidator>;
  unitOfDimension: string;
  onClose?: () => void;
};

const CutListLineForm = ({
  initialValues,
  unitOfDimension,
  onClose
}: CutListLineFormProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const permissions = usePermissions();
  const fetcher = useFetcher<{ id: string }>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  const [is2D, setIs2D] = useState(initialValues.pieceWidth !== undefined);

  // Sheet and plate need a width; bar and tube don't. The material's form
  // carries that (dimensionality), so resolve it when the item is picked.
  const onItemChange = async (itemId?: string) => {
    if (!carbon || !itemId) return;

    const item = await carbon
      .from("item")
      .select("readableId")
      .eq("id", itemId)
      .eq("companyId", company.id)
      .single();

    if (item.error || !item.data?.readableId) return;

    const material = await carbon
      .from("material")
      .select("materialForm(dimensionality)")
      .eq("id", item.data.readableId)
      .eq("companyId", company.id)
      .maybeSingle();

    if (material.error) {
      toast.error(t`Failed to load material properties`);
      return;
    }

    const dimensionality = (
      material.data?.materialForm as { dimensionality?: string } | null
    )?.dimensionality;
    setIs2D(dimensionality === "2D");
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={cutListLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.cutListLine(
                    initialValues.cutListId,
                    initialValues.id!
                  )
                : path.to.newCutListLine(initialValues.cutListId)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Piece` : t`Add Piece`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="cutListId" />
              <Hidden name="jobId" />
              <Hidden name="jobMaterialId" />
              <VStack spacing={4}>
                <Item
                  name="itemId"
                  label={t`Material`}
                  type="Material"
                  validItemTypes={["Material"]}
                  onChange={(value) =>
                    onItemChange(value?.value as string | undefined)
                  }
                />
                <Number
                  name="pieceLength"
                  label={t`Piece length (${unitOfDimension})`}
                  minValue={0}
                />
                {is2D && (
                  <Number
                    name="pieceWidth"
                    label={t`Piece width (${unitOfDimension})`}
                    minValue={0}
                  />
                )}
                <Number name="quantity" label={t`Pieces`} minValue={1} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>{t`Save`}</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CutListLineForm;
