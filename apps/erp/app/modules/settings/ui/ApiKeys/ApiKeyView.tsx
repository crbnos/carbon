import { getBrowserEnv } from "@carbon/auth";
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
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LuCheck, LuClipboard, LuLock } from "react-icons/lu";
import { copyToClipboard } from "~/utils/string";

type ApiKeyViewProps = {
  apiKey: string;
  // Extra alert shown above the standard one — used by regeneration to say the
  // previous key has stopped working.
  notice?: ReactNode;
  onClose: () => void;
};

/**
 * The one and only time a raw key is visible. Rendered after creation and
 * after regeneration; Carbon stores a hash, so there is no way back to it.
 */
function ApiKeyView({ apiKey, notice, onClose }: ApiKeyViewProps) {
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
      open
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
            {notice}
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

export default ApiKeyView;
