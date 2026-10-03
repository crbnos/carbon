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
  Screen,
  WarningNote
} from "~/components/ui";
import { ApiClientError, isServerTooOld } from "~/lib/api/errors";
import { useAuth } from "~/lib/auth/AuthProvider";
import { displayHost } from "~/lib/instances/resolve";

/**
 * Ask for a sign-in code.
 *
 * The server's hostname is shown on EVERY sign-in screen, and an `http`
 * connection is called out: a malicious QR code could point the app at a
 * look-alike server, and the host is the one thing that gives that away.
 * Nothing has left the device before this screen — the first request is the
 * one the operator starts by tapping the button.
 */
export default function SignIn() {
  const { t } = useLingui();
  const { requestCode, serverUrl, insecure } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const { signedIn } = await requestCode(email.trim());
      // Already in (local development's bypass account): go to the app, not
      // to a code screen with nothing to type into it.
      if (signedIn) router.replace("/");
      else router.push("/(auth)/verify");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(
          isServerTooOld(err)
            ? t`This Carbon server needs an update before the app can sign in.`
            : err.message
        );
      } else {
        setError(t`Could not reach the server`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll className="gap-5 py-6">
      <View className="gap-2">
        <Heading>
          <Trans>Sign in</Trans>
        </Heading>
        <Muted className="text-sm">
          {serverUrl ? displayHost(serverUrl) : ""}
        </Muted>
      </View>

      {insecure ? (
        <WarningNote>
          {t`This connection is not encrypted. Only continue on a network you trust.`}
        </WarningNote>
      ) : null}

      <Field
        label={t`Work email`}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        placeholder="you@example.com"
        returnKeyType="go"
        onSubmitEditing={() => void send()}
      />

      <Button
        disabled={!email.trim()}
        loading={busy}
        onPress={() => void send()}
      >
        {t`Send code`}
      </Button>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Button variant="ghost" onPress={() => router.push("/(setup)/instances")}>
        {t`Change server`}
      </Button>
    </Screen>
  );
}
