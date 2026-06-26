import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Select, Submit, TextArea } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { inboundInspectionValidator } from "~/modules/quality/quality.models";

type InboundInspectionFormProps = {
  inspectionId: string;
  itemReadableId: string;
  itemName: string;
  serialOrBatch: string;
  receiptReadableId: string;
  receiverId: string | null;
  currentUserId: string;
  enforceFourEyes: boolean;
  disabled?: boolean;
  open?: boolean;
  action: string;
  onClose: () => void;
};

const InboundInspectionForm = ({
  inspectionId,
  itemReadableId,
  itemName,
  serialOrBatch,
  receiptReadableId,
  receiverId,
  currentUserId,
  enforceFourEyes,
  disabled,
  open = true,
  action,
  onClose
}: InboundInspectionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const statusOptions = [
    { value: "Passed", label: t`Pass` },
    { value: "Failed", label: t`Fail` }
  ];

  const showFourEyesWarning =
    enforceFourEyes && !!receiverId && receiverId === currentUserId;

  const canUpdate = permissions.can("update", "quality");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            method="post"
            action={action}
            validator={inboundInspectionValidator}
            defaultValues={{
              id: inspectionId,
              status: undefined,
              notes: ""
            }}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Inspect</Trans> {itemReadableId}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4} className="w-full">
                <div className="grid grid-cols-2 gap-4 w-full text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      <Trans>Item</Trans>
                    </div>
                    <div className="font-medium">{itemReadableId}</div>
                    <div className="text-muted-foreground">{itemName}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      <Trans>Serial / Batch</Trans>
                    </div>
                    <div className="font-medium">{serialOrBatch || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      <Trans>Receipt</Trans>
                    </div>
                    <div className="font-medium">{receiptReadableId}</div>
                  </div>
                </div>

                {showFourEyesWarning && (
                  <Alert variant="warning">
                    <LuTriangleAlert className="size-4" />
                    <AlertTitle>
                      <Trans>You received this item</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        Company policy asks for a different person to inspect
                        inbound items than the one who received them.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                )}

                <Select
                  name="status"
                  label={t`Disposition`}
                  termId="inbound-inspection-disposition"
                  options={statusOptions}
                />

                <TextArea name="notes" label={t`Notes`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack spacing={2}>
                <Button variant="secondary" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
                <Submit isDisabled={disabled || !canUpdate}>
                  <Trans>Submit Inspection</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default InboundInspectionForm;
