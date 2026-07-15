import {
  Combobox,
  DatePicker,
  Select,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { FetcherWithComponents } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  MultiSelect,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useItems } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  changeOrderPriority,
  changeOrderValidator
} from "../../changeOrder.models";

type ChangeOrderFormValues = z.infer<typeof changeOrderValidator>;

type ChangeOrderFormProps = {
  initialValues: ChangeOrderFormValues;
  types: ListItem[];
  // Phase 4 links a Non-Conformance; a lightweight list is passed so the
  // create form can associate one up-front. Optional — omit for Minimal.
  nonConformances?: ListItem[];
  // "page" (default) renders in a Card on the create route; "modal" renders in a
  // ModalDrawer launched from an item detail page (item pre-selected as affected).
  type?: "page" | "modal";
  open?: boolean;
  onClose?: () => void;
  fetcher?: FetcherWithComponents<unknown>;
};

const ChangeOrderForm = ({
  initialValues,
  types,
  nonConformances = [],
  type = "page",
  open,
  onClose,
  fetcher
}: ChangeOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;
  const isModal = type === "modal";

  const [items] = useItems();
  // Affected items are Parts/Tools only (matches CO affected-item scope); the
  // service coerces Buy items to Revision. Include all active revisions so a
  // pre-selected non-latest revision still resolves to a visible option.
  const itemOptions = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.active && (item.type === "Part" || item.type === "Tool")
        )
        .map((item) => ({
          value: item.id,
          label: item.readableIdWithRevision
        })),
    [items]
  );

  const fields = (
    <>
      <Hidden name="id" />
      <Hidden name="changeOrderId" />

      <VStack spacing={4}>
        <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
          <Input name="name" label={t`Name`} />
          <Combobox
            name="changeOrderTypeId"
            label={t`Category`}
            options={types.map((coType) => ({
              label: coType.name,
              value: coType.id
            }))}
          />
        </div>
        <TextArea name="reasonForChange" label={t`Reason for Change`} />
        <TextArea name="description" label={t`Description of Change`} />
        <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
          <Employee name="assignee" label={t`Owner`} />
          <Select
            name="priority"
            label={t`Priority`}
            options={changeOrderPriority.map((priority) => ({
              label: priority,
              value: priority
            }))}
          />
          <DatePicker name="openDate" label={t`Open Date`} />
          <DatePicker name="dueDate" label={t`Due Date`} />
          {nonConformances.length > 0 && (
            <Combobox
              name="nonConformanceId"
              label={t`Linked NCR`}
              options={nonConformances.map((nc) => ({
                label: nc.name,
                value: nc.id
              }))}
            />
          )}
          <CustomFormFields table="changeOrder" />
        </div>
        {!isEditing && (
          <MultiSelect
            name="affectedItemIds"
            label={t`Affected Parts & Tools`}
            options={itemOptions}
          />
        )}
      </VStack>
    </>
  );

  const submit = (
    // No unsaved-changes blocker: Save intentionally redirects to the new CO, so
    // the guard would always fire on submit (matches other create forms).
    <Submit
      withBlocker={false}
      isDisabled={
        isEditing
          ? !permissions.can("update", "parts")
          : !permissions.can("create", "parts")
      }
    >
      <Trans>Save</Trans>
    </Submit>
  );

  if (isModal) {
    return (
      <ModalDrawerProvider type="modal">
        <ModalDrawer
          open={open}
          onOpenChange={(o) => {
            if (!o) onClose?.();
          }}
        >
          <ModalDrawerContent>
            <ValidatedForm
              method="post"
              action={path.to.newChangeOrder}
              validator={changeOrderValidator}
              defaultValues={initialValues}
              fetcher={fetcher}
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>New Change Order</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>{fields}</ModalDrawerBody>
              <ModalDrawerFooter>
                <HStack>
                  {submit}
                  <Button size="md" variant="solid" onClick={() => onClose?.()}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </ValidatedForm>
          </ModalDrawerContent>
        </ModalDrawer>
      </ModalDrawerProvider>
    );
  }

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={changeOrderValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Change Order</Trans>
            ) : (
              <Trans>New Change Order</Trans>
            )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A change order tracks a controlled engineering or manufacturing
                change through review and implementation.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>{fields}</CardContent>
        <CardFooter>{submit}</CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ChangeOrderForm;
