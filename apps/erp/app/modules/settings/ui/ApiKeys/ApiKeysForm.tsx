// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getBrowserEnv } from "@carbon/auth";
import { MODULES, moduleOf, PAGES } from "@carbon/database/access";
import type { StoredGrant } from "@carbon/database/access-write";
import { SUBJECT_RULES, subjectGates } from "@carbon/ee/permission-grants";
import { DateTimePicker, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertTitle,
  Button,
  HStack,
  IconButton,
  Input as InputBase,
  InputGroup,
  InputRightElement,
  Label,
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
import { useEffect, useState } from "react";
import { LuCheck, LuClipboard, LuLock } from "react-icons/lu";
import type { z } from "zod";
import { Hidden, Input, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { apiKeyValidator } from "~/modules/settings/settings.models";
import AccessGrid from "~/modules/users/ui/components/AccessGrid.ee";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";

const keyRules = SUBJECT_RULES.key;

const keyPages = PAGES.filter((page) =>
  (keyRules.modules as readonly string[]).includes(moduleOf(page.id))
);

/** Every module a key may hold, each where "select all" stops. */
const selectAllGrants = (): StoredGrant[] =>
  MODULES.filter((module) => keyRules.modules.includes(module.id)).map(
    (module) => ({
      module: module.enum,
      page: null,
      level: keyRules.selectAllCaps[module.id] ?? "Full"
    })
  );

type ApiKeyFormProps = {
  initialValues: Omit<z.infer<typeof apiKeyValidator>, "grants">;
  existingGrants?: StoredGrant[];
  /** A single-tenant deployment's admins set the limit; Carbon Cloud sets it. */
  canSetRateLimit?: boolean;
  open?: boolean;
  onClose: () => void;
};

const ApiKeyForm = ({
  initialValues,
  existingGrants = [],
  canSetRateLimit,
  open = true,
  onClose
}: ApiKeyFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useAction({
    onSuccess: ({ data }) => {
      if (data?.key) setKey(data.key);
    }
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = !permissions.has(subjectGates("Edit").key);

  const [key, setKey] = useState<string | null>(null);

  // The person's edits; the route remounts the form for another key.
  const [grants, setGrants] = useState(existingGrants);

  return (
    <>
      <Modal
        open={open}
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
            <ModalBody>
              <Hidden name="id" />
              <Hidden name="grants" value={JSON.stringify(grants)} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />

                <DateTimePicker
                  name="expiresAt"
                  label={t`Expires At (optional)`}
                  minValue={toCalendarDateTime(today(getLocalTimeZone()))}
                />

                {canSetRateLimit && (
                  <Number
                    name="rateLimit"
                    label={t`Requests per minute`}
                    minValue={1}
                    maxValue={1_000_000}
                  />
                )}

                <div className="flex w-full justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    isDisabled={isDisabled}
                    onClick={() => setGrants(selectAllGrants())}
                  >
                    <Trans>Select all</Trans>
                  </Button>
                </div>
                <AccessGrid
                  pages={keyPages}
                  value={grants}
                  onChange={setGrants}
                  label={t`Access`}
                  isDisabled={isDisabled}
                  selectAllCaps={keyRules.selectAllCaps}
                />
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
      {key && <ApiKeyView apiKey={key} open={open} onClose={onClose} />}
    </>
  );
};

export default ApiKeyForm;

type ApiKeyViewProps = {
  apiKey: string;
  open?: boolean;
  onClose: () => void;
};

function ApiKeyView({ apiKey, open = true, onClose }: ApiKeyViewProps) {
  const { t } = useLingui();
  const [copied, setCopied] = useState<"key" | "mcp" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const { ERP_URL } = getBrowserEnv();
  const mcpCommand = `claude mcp add --transport http \\
  carbon ${ERP_URL}/api/mcp \\
  --header "Authorization: Bearer ${apiKey}"`;

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>API Key</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <Alert variant="info">
              <LuLock className="w-4 h-4" />
              <AlertTitle>
                <Trans>You can only see this key once. Store it safely.</Trans>
              </AlertTitle>
            </Alert>
            <div className="flex flex-col gap-2 w-full">
              <Label htmlFor="api-key">
                <Trans>API Key</Trans>
              </Label>
              <InputGroup>
                <InputBase id="api-key" value={apiKey} />
                <InputRightElement className="w-[2.75rem]">
                  <IconButton
                    aria-label={t`Copy API Key`}
                    icon={copied === "key" ? <LuCheck /> : <LuClipboard />}
                    variant="ghost"
                    onClick={() => {
                      copyToClipboard(apiKey, () => {
                        setCopied("key");
                      });
                    }}
                  />
                </InputRightElement>
              </InputGroup>
            </div>
            <div className="flex flex-col gap-2 w-full">
              <Label htmlFor="mcp-command">
                <Trans>MCP Command</Trans>
              </Label>
              <InputGroup>
                <InputBase id="mcp-command" value={mcpCommand} />
                <InputRightElement className="w-[2.75rem]">
                  <IconButton
                    aria-label={t`Copy MCP Command`}
                    icon={copied === "mcp" ? <LuCheck /> : <LuClipboard />}
                    variant="ghost"
                    onClick={() => {
                      copyToClipboard(mcpCommand, () => {
                        setCopied("mcp");
                      });
                    }}
                  />
                </InputRightElement>
              </InputGroup>
            </div>
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
              <Trans>Close</Trans>
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
