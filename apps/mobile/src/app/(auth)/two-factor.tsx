// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  Button,
  ErrorNote,
  Field,
  Heading,
  Muted,
  Screen
} from "~/components/ui";
import { ApiClientError } from "~/lib/api/errors";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The TOTP challenge. Enrolment stays in Carbon on the web — MES defers a
 * first login to the ERP, and this screen only clears an existing factor.
 */
export default function TwoFactor() {
  const { t } = useLingui();
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    setError(null);
    setBusy(true);
    try {
      await verifyMfa(value);
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : t`Could not reach the server`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll className="gap-5 py-6">
      <View className="gap-2">
        <Heading>
          <Trans>Two-factor code</Trans>
        </Heading>
        <Muted>
          <Trans>Open your authenticator app and enter the current code.</Trans>
        </Muted>
      </View>

      <Field
        label={t`6-digit code`}
        value={code}
        onChangeText={(next) => {
          const digits = next.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void submit(digits);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className="text-center text-3xl tracking-[8px]"
        autoFocus
      />

      <Button
        disabled={code.length !== 6}
        loading={busy}
        onPress={() => void submit(code)}
      >
        {t`Continue`}
      </Button>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Screen>
  );
}
