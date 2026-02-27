import { DateTimePicker, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertTitle,
  Button,
  HStack,
  IconButton,
  Input as InputBase,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { useEffect, useMemo, useState } from "react";
import { LuCheck, LuClipboard, LuLock } from "react-icons/lu";
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
import { copyToClipboard } from "~/utils/string";

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
    []
  );

  const matrix = usePermissionMatrix({
    modules: apiKeyPermissionModules,
    initialState: initialScopeState
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.key) {
      setKey(fetcher.data.key);
    }
  }, [fetcher.data, fetcher.state, onClose]);

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
              <ModalTitle>{isEditing ? "Edit" : "New"} API Key</ModalTitle>
            </ModalHeader>
            <ModalBody className="max-h-[70dvh] overflow-y-auto">
              <Hidden name="id" />
              <Hidden name="scopes" value={scopesJsonb} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />

                <DateTimePicker
                  name="expiresAt"
                  label="Expires At (optional)"
                />

                <PermissionMatrix matrix={matrix} />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  Cancel
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

type ApiKeyViewProps = {
  apiKey: string;
  onClose: () => void;
};

function ApiKeyView({ apiKey, onClose }: ApiKeyViewProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>API Key</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <Alert variant="warning">
              <LuLock className="w-4 h-4" />
              <AlertTitle>
                You can only see this key once. Store it safely.
              </AlertTitle>
            </Alert>
            <InputGroup>
              <InputBase value={apiKey} />
              <InputRightElement className="w-[2.75rem]">
                <IconButton
                  aria-label="Copy"
                  icon={copied ? <LuCheck /> : <LuClipboard />}
                  variant="ghost"
                  onClick={() => {
                    copyToClipboard(apiKey, () => {
                      setCopied(true);
                    });
                  }}
                />
              </InputRightElement>
            </InputGroup>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button
              size="md"
              variant="solid"
              onClick={() => {
                onClose();
              }}
            >
              Close
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
