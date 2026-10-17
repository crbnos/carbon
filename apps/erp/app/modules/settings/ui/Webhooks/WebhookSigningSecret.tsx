// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  Copy,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input as InputBase,
  InputGroup,
  InputRightElement,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { path } from "~/utils/path";

type SigningSecretResponse =
  | { secret: string; error: null }
  | { secret: null; error: string };

// Lives inside the webhook drawer's form, so it submits with fetcher calls,
// never a nested <form>.
export default function WebhookSigningSecret({
  webhookId,
  isDisabled
}: {
  webhookId: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmingRoll, setConfirmingRoll] = useState(false);

  const reveal = useAction<SigningSecretResponse>({
    onSuccess: (data) => setSecret(data.secret),
    onError: (data) => toast.error(data.error ?? t`Failed to reveal the secret`)
  });
  const roll = useAction<SigningSecretResponse>({
    onSuccess: (data) => {
      setSecret(data.secret);
      toast.success(t`Rolled the signing secret`);
    },
    onError: (data) => toast.error(data.error ?? t`Failed to roll the secret`)
  });

  const action = path.to.webhookSigningSecret(webhookId);

  return (
    <FormControl>
      <FormLabel>
        <Trans>Signing secret</Trans>
      </FormLabel>
      <InputGroup>
        <InputBase
          isReadOnly
          aria-label={t`Signing secret`}
          value={secret ?? "whsec_••••••••••••••••"}
          className="font-mono"
        />
        <InputRightElement className={secret ? "w-[2.75rem]" : "w-auto pr-1"}>
          {secret ? (
            <Copy
              text={secret}
              label={t`Copy signing secret`}
              variant="ghost"
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              isDisabled={isDisabled}
              isLoading={reveal.isPending}
              onClick={() => reveal.load(action)}
            >
              <Trans>Reveal</Trans>
            </Button>
          )}
        </InputRightElement>
      </InputGroup>
      <FormHelperText>
        <Trans>
          Every delivery carries a Carbon-Signature header signed with this
          secret. Verify it to know a request came from Carbon.
        </Trans>
      </FormHelperText>
      {confirmingRoll ? (
        <Alert variant="warning" className="mt-2">
          <AlertDescription>
            <Trans>
              Deliveries are signed with the new secret at once. Update your
              endpoint with it.
            </Trans>
          </AlertDescription>
          <HStack className="mt-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              isLoading={roll.isPending}
              onClick={() => {
                roll.submit(null, { method: "post", action });
                setConfirmingRoll(false);
              }}
            >
              <Trans>Roll secret</Trans>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setConfirmingRoll(false)}
            >
              <Trans>Cancel</Trans>
            </Button>
          </HStack>
        </Alert>
      ) : (
        <div className="mt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isDisabled={isDisabled}
            isLoading={roll.isPending}
            onClick={() => setConfirmingRoll(true)}
          >
            <Trans>Roll secret</Trans>
          </Button>
        </div>
      )}
    </FormControl>
  );
}
