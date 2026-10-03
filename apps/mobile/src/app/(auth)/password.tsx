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
 * Only reachable when `POST /auth/code` answered `method: "password"`, which
 * happens for an allow-listed store-review account on Carbon Cloud and nowhere
 * else. An ordinary operator never sees this screen.
 */
export default function Password() {
  const { t } = useLingui();
  const { signInWithPassword, email } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword(password);
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
          <Trans>Enter your password</Trans>
        </Heading>
        <Muted>{email ?? ""}</Muted>
      </View>

      <Field
        label={t`Password`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        autoFocus
      />

      <Button disabled={!password} loading={busy} onPress={() => void submit()}>
        {t`Sign in`}
      </Button>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Button variant="ghost" onPress={() => router.replace("/(auth)/sign-in")}>
        {t`Use a different email`}
      </Button>
    </Screen>
  );
}
