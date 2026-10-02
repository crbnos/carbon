// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import {
  type BarcodeScanningResult,
  CameraView,
  useCameraPermissions
} from "expo-camera";
import { Camera, CameraOff } from "lucide-react-native";
import { useCallback, useEffect, useRef } from "react";
import { Linking, useColorScheme, View } from "react-native";
import { themeColor } from "~/components/themeColors";
import { Button, Card, ErrorNote, Muted, Skeleton } from "~/components/ui";

/**
 * The camera as a barcode scanner.
 *
 * `onBarcodeScanned` fires continuously while a code is in frame — several
 * times a second — so every read passes through a cooldown. 1.5 s is long
 * enough that one presentation of a label is one scan, and short enough that an
 * operator working through a bin of parts is not waiting on us.
 *
 * Every permission state renders something. A scanner screen that is blank
 * because iOS refused the camera is indistinguishable from a broken app, and an
 * operator on a tablet clamped to a machine has no way to find out which it is.
 */

/** One scan per code presentation, not per frame. */
const SCAN_COOLDOWN_MS = 1500;

/**
 * What Carbon prints. QR on travellers and kanban cards, Code 128 and Data
 * Matrix on part and serial labels, EAN-13 for bought goods that arrive with a
 * retail barcode.
 */
const BARCODE_TYPES = ["qr", "code128", "datamatrix", "ean13"] as const;

export function CameraScanner({
  onScan,
  active = true,
  className
}: {
  onScan: (text: string) => void;
  /**
   * False releases the camera. Pass the screen's focus state: a preview left
   * running behind another tab drains the battery and keeps firing reads at a
   * screen nobody is looking at.
   */
  active?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const scheme = useColorScheme();
  const [permission, requestPermission] = useCameraPermissions();

  const cooling = useRef(false);
  const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (cooldown.current) clearTimeout(cooldown.current);
    },
    []
  );

  const handleBarcode = useCallback(
    (result: BarcodeScanningResult) => {
      if (cooling.current) return;
      const text = result.data?.trim();
      if (!text) return;

      // A boolean plus a timer rather than comparing timestamps: there is no
      // clock arithmetic in this app (AGENTS.md), and this needs none.
      cooling.current = true;
      cooldown.current = setTimeout(() => {
        cooling.current = false;
      }, SCAN_COOLDOWN_MS);

      onScan(text);
    },
    [onScan]
  );

  const frame = `overflow-hidden rounded-lg border border-border bg-muted ${
    className ?? ""
  }`;

  // Still reading the current status. A skeleton, never an empty frame.
  if (!permission) return <Skeleton className={className} />;

  if (!permission.granted) {
    // Asked and refused for good, so the only way back is the Settings app.
    // The wedge is still live, which is what an operator with a paired
    // scanner needs to hear before they go hunting for a setting.
    if (!permission.canAskAgain) {
      return (
        <View className="gap-3">
          <ErrorNote>
            {t`Carbon MES cannot use the camera. Turn the camera on for Carbon MES in your device's Settings app.`}
          </ErrorNote>
          <Muted className="text-sm">
            <Trans>A connected barcode scanner still works.</Trans>
          </Muted>
          <Button
            variant="secondary"
            onPress={() => void Linking.openSettings()}
            accessibilityLabel={t`Open the Settings app`}
          >
            <Trans>Open Settings</Trans>
          </Button>
        </View>
      );
    }

    // Not asked yet, or refused once on Android. Asking costs a tap, so say
    // what it is for first and let the operator start it.
    return (
      <Card className="gap-3">
        <View className="flex-row items-center gap-3">
          <Camera size={24} color={themeColor(scheme, "mutedForeground")} />
          <Muted className="flex-1">
            {t`Carbon MES needs the camera to read barcodes and QR codes.`}
          </Muted>
        </View>
        <Button
          onPress={() => void requestPermission()}
          accessibilityLabel={t`Allow Carbon MES to use the camera`}
        >
          <Trans>Allow the camera</Trans>
        </Button>
        <Muted className="text-sm">
          <Trans>A connected barcode scanner works without it.</Trans>
        </Muted>
      </Card>
    );
  }

  if (!active) {
    return (
      <View className={`items-center justify-center gap-2 ${frame}`}>
        <CameraOff size={28} color={themeColor(scheme, "mutedForeground")} />
        <Muted className="text-sm">
          <Trans>The camera is off</Trans>
        </Muted>
      </View>
    );
  }

  return (
    <View className={frame}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={handleBarcode}
      />
      {/* A target to aim at. Nothing is hidden behind it and it takes no
          touches — it is there so an operator knows where to hold the label.
          Drawn with border classes rather than an icon because it sits on a
          live camera image, which no theme token describes. */}
      <View
        pointerEvents="none"
        className="absolute inset-0 items-center justify-center"
      >
        <View className="size-48 rounded-xl border-2 border-white/70" />
      </View>
    </View>
  );
}
