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
import type { FetcherWithComponents } from "react-router";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import {
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  changeNoticePriority,
  changeNoticeValidator
} from "../../items.models";
import ChangeNoticePriority from "./ChangeNoticePriority";

type ChangeNoticeFormValues = z.infer<typeof changeNoticeValidator>;

type ChangeNoticeFormProps = {
  initialValues: ChangeNoticeFormValues;
  types: ListItem[];
  // "page" (default) renders in a Card on the create route; "modal" renders in a
  // ModalDrawer launched from an item detail page (item pre-selected as affected).
  type?: "page" | "modal";
  open?: boolean;
  onClose?: () => void;
  fetcher?: FetcherWithComponents<unknown>;
};

const ChangeNoticeForm = ({
  initialValues,
  types,
  type = "page",
  open,
  onClose,
  fetcher
}: ChangeNoticeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;
  const isModal = type === "modal";

  const fields = (
    <>
      <Hidden name="id" />
      <Hidden name="changeOrderId" />
      {/* Linked NCR is set by the source (e.g. "Create Change Notice" from an
          Issue) and carried silently — not a user-editable field. */}
      <Hidden name="nonConformanceId" />
      {/* Affected Parts are added on the CO detail page (top-to-bottom flow), not
          chosen here. The create form only carries any pre-selected item (e.g.
          when opened from a part page via CreateChangeNoticeModal) as hidden
          inputs so it's still attached on create. */}
      {!isEditing &&
        (initialValues.affectedItemIds ?? []).map((itemId) => (
          <input
            key={itemId}
            type="hidden"
            name="affectedItemIds"
            value={itemId}
          />
        ))}

      <VStack spacing={4}>
        <div
          className={`grid w-full gap-4 grid-cols-1 ${
            isModal ? "" : "md:grid-cols-2"
          }`}
        >
          <Input name="name" label={t`Name`} />
          <Combobox
            name="changeOrderTypeId"
            label={t`Category`}
            options={types.map((coType) => ({
              label: <Enumerable value={coType.name} />,
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
            options={changeNoticePriority.map((priority) => ({
              label: <ChangeNoticePriority priority={priority} />,
              value: priority
            }))}
          />
          <DatePicker name="openDate" label={t`Open Date`} />
          <DatePicker name="dueDate" label={t`Due Date`} />
          <CustomFormFields table="changeOrder" />
        </div>
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
              action={path.to.newChangeNotice}
              validator={changeNoticeValidator}
              defaultValues={initialValues}
              fetcher={fetcher}
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>New Change Notice</Trans>
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
        validator={changeNoticeValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Change Notice</Trans>
            ) : (
              <Trans>New Change Notice</Trans>
            )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A change notice tracks a controlled engineering or manufacturing
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

export default ChangeNoticeForm;
