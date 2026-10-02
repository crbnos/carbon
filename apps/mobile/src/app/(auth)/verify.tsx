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
import { displayHost } from "~/lib/instances/resolve";

export default function Verify() {
  const { t } = useLingui();
  const { verifyCode, requestCode, email, serverUrl } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(value: string) {
    setError(null);
    setBusy(true);
    try {
      await verifyCode(value);
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
          <Trans>Enter your code</Trans>
        </Heading>
        <Muted>
          <Trans>We emailed a 6-digit code to {email ?? ""}.</Trans>
        </Muted>
        <Muted className="text-sm">
          {serverUrl ? displayHost(serverUrl) : ""}
        </Muted>
      </View>

      <Field
        label={t`6-digit code`}
        value={code}
        onChangeText={(next) => {
          const digits = next.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          // Submit as soon as the sixth digit lands: nobody on a shop floor
          // wants to reach for a button after typing a code.
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

      <Button
        variant="ghost"
        disabled={busy || resent || !email}
        onPress={async () => {
          if (!email) return;
          setError(null);
          try {
            await requestCode(email);
            setResent(true);
          } catch (err) {
            setError(
              err instanceof ApiClientError
                ? err.message
                : t`Could not reach the server`
            );
          }
        }}
      >
        {resent ? t`Code sent` : t`Send a new code`}
      </Button>

      <Button variant="ghost" onPress={() => router.replace("/(auth)/sign-in")}>
        {t`Use a different email`}
      </Button>
    </Screen>
  );
}
