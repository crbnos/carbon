// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  Body,
  Button,
  Field,
  Heading,
  Muted,
  Screen,
  WarningNote
} from "~/components/ui";
import { useInstances } from "~/lib/instances/InstanceProvider";
import {
  CARBON_CLOUD_URL,
  resolveServerAddress
} from "~/lib/instances/resolve";

/**
 * Link this device to a Carbon.
 *
 * NOTHING is fetched here. The address is validated and saved; the first
 * request happens on the sign-in screen when the operator asks for a code. That
 * is deliberate: before sign-in the app must make no outbound call at all, so
 * an air-gapped or controlled install can never be made to phone home by
 * merely being linked.
 */
export default function Connect() {
  const { t } = useLingui();
  const { link, instances } = useInstances();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(input: string) {
    setError(null);
    const resolved = resolveServerAddress(input);
    if (!resolved) {
      setError(t`That does not look like a Carbon address`);
      return;
    }
    setBusy(true);
    try {
      await link({ serverUrl: resolved.url, scheme: resolved.scheme });
      router.replace("/(auth)/sign-in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll className="gap-5 py-6">
      <View className="gap-2">
        <Heading>
          <Trans>Connect to Carbon</Trans>
        </Heading>
        <Muted>
          <Trans>
            Scan the code from Carbon, or type your server's address. Your
            supervisor can show the code from Settings.
          </Trans>
        </Muted>
      </View>

      {scanning ? (
        <View className="h-[300px] overflow-hidden rounded-lg border border-border">
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => {
              if (busy) return;
              setScanning(false);
              void connect(data);
            }}
          />
        </View>
      ) : (
        <Button
          variant="secondary"
          onPress={async () => {
            if (!permission?.granted) {
              const result = await requestPermission();
              if (!result.granted) {
                setError(t`Allow camera access to scan the code`);
                return;
              }
            }
            setScanning(true);
          }}
        >
          {t`Scan the code`}
        </Button>
      )}

      <View className="gap-2">
        <Field
          label={t`Or type the address`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="carbon.example.com"
          returnKeyType="go"
          onSubmitEditing={() => void connect(typed)}
        />
        <Button
          disabled={!typed.trim()}
          loading={busy}
          onPress={() => void connect(typed)}
        >
          {t`Connect`}
        </Button>
      </View>

      {error ? <WarningNote>{error}</WarningNote> : null}

      <View className="gap-2 border-t border-border pt-5">
        <Body className="font-semibold">
          <Trans>Using Carbon Cloud?</Trans>
        </Body>
        <Muted className="text-sm">
          <Trans>
            Cloud has more than one region. If your team gave you a code, scan
            that instead.
          </Trans>
        </Muted>
        <Button
          variant="secondary"
          onPress={() => void connect(CARBON_CLOUD_URL)}
        >
          {t`Use Carbon Cloud`}
        </Button>
      </View>

      {instances.length > 0 ? (
        <Button
          variant="ghost"
          onPress={() => router.push("/(setup)/instances")}
        >
          {t`Switch server`}
        </Button>
      ) : null}
    </Screen>
  );
}
