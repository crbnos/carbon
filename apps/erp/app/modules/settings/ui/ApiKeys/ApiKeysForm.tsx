import { DateTimePicker, ValidatedForm } from "@carbon/form";
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
import {
  getLocalTimeZone,
  toCalendarDateTime,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import { usePermissions } from "~/hooks";
import {
  fromApiKeyScopes,
  toApiKeyScopes,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import { apiKeyPermissionModules, apiKeyValidator } from "~/modules/settings";
import { path } from "~/utils/path";
import ApiKeyView from "./ApiKeyView";

type ApiKeyFormProps = {
  initialValues: z.infer<typeof apiKeyValidator>;
  companyId?: string;
  existingScopes?: Record<string, string[]> | null;
  onClose: () => void;
};

const ApiKeyForm = ({
  initialValues,
  companyId,
  existingScopes,
  onClose
}: ApiKeyFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{ key: string }>();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !permissions.can("update", "users");

  const [key, setKey] = useState<string | null>(null);

  const initialScopeState = useMemo(
    () =>
      isEditing
        ? fromApiKeyScopes(existingScopes, apiKeyPermissionModules)
        : fromApiKeyScopes(null, apiKeyPermissionModules),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [existingScopes, isEditing]
  );

  const matrix = usePermissionMatrix({
    modules: apiKeyPermissionModules,
    initialState: initialScopeState
  });

  useEffect(() => {
    if (fetcher.data?.key) {
      setKey(fetcher.data.key);
    }
  }, [fetcher.data]);

  // Serialize scopes to JSONB format for form submission
  const scopesJsonb = companyId
    ? JSON.stringify(toApiKeyScopes(matrix.permissions, companyId))
    : "{}";

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalContent size="xlarge">
          <ValidatedForm
            validator={apiKeyValidator}
            method="post"
            action={
              isEditing ? path.to.apiKey(initialValues.id!) : path.to.newApiKey
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalHeader>
              <ModalTitle>
                {isEditing ? (
                  <Trans>Edit API Key</Trans>
                ) : (
                  <Trans>New API Key</Trans>
                )}
              </ModalTitle>
            </ModalHeader>
            <ModalBody className="max-h-[70dvh] overflow-y-auto">
              <Hidden name="id" />
              <Hidden name="scopes" value={scopesJsonb} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />

                <DateTimePicker
                  name="expiresAt"
                  label={t`Expires At (optional)`}
                  minValue={toCalendarDateTime(today(getLocalTimeZone()))}
                />

                <PermissionMatrix matrix={matrix} />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalFooter>
          </ValidatedForm>
        </ModalContent>
      </Modal>
      {key && <ApiKeyView apiKey={key} onClose={onClose} />}
    </>
  );
};

export default ApiKeyForm;
