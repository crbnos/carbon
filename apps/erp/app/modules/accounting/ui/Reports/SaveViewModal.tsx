import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Hidden, Input, Select, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import type { AnalyticsReportKey, PivotState } from "../../accounting.models";
import {
  reportViewValidator,
  reportViewVisibilities
} from "../../accounting.models";
import type { ReportView } from "../../types";

type SaveViewModalProps = {
  reportKey: AnalyticsReportKey;
  /** The current pivot state — saved as the view's config */
  state: PivotState;
  /** The active saved view, if any. Editable only when owned by the current user. */
  view?: ReportView;
  onClose: () => void;
};

const SaveViewModal = ({
  reportKey,
  state,
  view,
  onClose
}: SaveViewModalProps) => {
  const { t } = useLingui();
  const { id: userId } = useUser();
  const fetcher = useFetcher<{ fieldErrors?: Record<string, string> }>();

  // Only the owner edits (RLS enforces this server-side too); a shared view
  // someone else created is saved as a new view instead.
  const isEditing = !!view && view.createdBy === userId;

  useEffect(() => {
    if (
      fetcher.state === "loading" &&
      fetcher.data != null &&
      !fetcher.data.fieldErrors
    ) {
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const visibilityOptions = reportViewVisibilities.map((visibility) => ({
    value: visibility,
    label: visibility === "Private" ? t`Private` : t`Company`
  }));

  const onDelete = () => {
    if (!isEditing || !view) return;
    fetcher.submit({ intent: "delete-view", id: view.id }, { method: "post" });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={reportViewValidator}
          method="post"
          defaultValues={{
            id: isEditing ? view.id : undefined,
            reportKey,
            name: isEditing ? view.name : "",
            visibility: isEditing ? view.visibility : "Private",
            config: JSON.stringify(state)
          }}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>
              {isEditing ? <Trans>Edit View</Trans> : <Trans>Save View</Trans>}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            {isEditing && <Hidden name="id" />}
            <Hidden name="intent" value="save-view" />
            <Hidden name="reportKey" value={reportKey} />
            <Hidden name="config" value={JSON.stringify(state)} />
            <VStack spacing={4}>
              <Input name="name" label={t`Name`} />
              <Select
                name="visibility"
                label={t`Visibility`}
                options={visibilityOptions}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack className="w-full justify-between">
              <div>
                {isEditing && (
                  <Button
                    variant="destructive"
                    isLoading={
                      fetcher.state !== "idle" &&
                      fetcher.formData?.get("intent") === "delete-view"
                    }
                    onClick={onDelete}
                  >
                    <Trans>Delete</Trans>
                  </Button>
                )}
              </div>
              <HStack>
                <Submit>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SaveViewModal;
