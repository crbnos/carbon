// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatQuantity } from "@carbon/utils/format";
import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { TextInput, View } from "react-native";
import { StatusBadge } from "~/components/StatusBadge";
import {
  Body,
  Card,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { useIsTablet } from "~/components/useIsTablet";
import { CameraScanner } from "~/features/scan/CameraScanner";
import { parseScan, type ScanResult } from "~/features/scan/parseScan";
import { useKeyboardWedge } from "~/features/scan/useKeyboardWedge";
import {
  type ScanLookupState,
  useScanLookup
} from "~/features/scan/useScanLookup";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * Scan: the camera and a connected barcode scanner, together.
 *
 * Both paths land in one `handleScan`, so a camera read and a wedge burst
 * cannot behave differently — that was the whole point of making `parseScan`
 * pure. A Carbon URL navigates immediately, the way scanning a traveller does
 * in web MES; anything else is looked up and named on the card.
 *
 * The result card is persistent, not a toast. An operator holding a part in one
 * hand and a tablet in the other should be able to look back at what the last
 * scan was, and "nothing matches" is exactly the message a toast would take
 * away before they read it.
 */
export default function Scan() {
  const { serverUrl } = useAuth();
  const isTablet = useIsTablet();
  const { state, lookup, reset } = useScanLookup();
  const [last, setLast] = useState<ScanResult | null>(null);

  // The camera is released whenever the operator is on another tab: a preview
  // running behind the Operations screen drains the battery and keeps reading
  // codes nobody is holding up.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  const handleScan = useCallback(
    (text: string) => {
      const scan = parseScan(text, serverUrl);
      setLast(scan);

      if (scan.kind === "code") {
        lookup(scan.value);
        return;
      }

      // A URL or another instance's URL is answered by `parseScan` alone, so
      // any pending code result would be stale under it.
      reset();

      if (scan.kind !== "url") return;
      // `start` and `end` arrive at the same place as `operation`: the
      // operation screen is where the timer and the finish action live, so an
      // operator who scanned the start QR lands exactly where they can act.
      // Web's `/x/start/:id` is a loader that writes; firing that event
      // straight off the scan is a separate decision from routing, and it
      // belongs with the operation screen's own start command.
      const path =
        scan.route === "picking"
          ? `/(app)/(tabs)/picking/${scan.id}`
          : `/(app)/operation/${scan.id}`;
      router.push(path as never);
    },
    [lookup, reset, serverUrl]
  );

  const wedge = useKeyboardWedge({ onScan: handleScan });

  return (
    <Screen className="gap-4 py-4">
      <View className="gap-1">
        <Heading>
          <Trans>Scan</Trans>
        </Heading>
        <Muted className="text-sm">
          <Trans>
            Hold a traveller, a kanban card or a part label up to the camera, or
            use a connected barcode scanner.
          </Trans>
        </Muted>
      </View>

      <View className={isTablet ? "flex-1 flex-row gap-4" : "gap-4"}>
        <CameraScanner
          active={focused}
          onScan={handleScan}
          className={isTablet ? "flex-1" : "h-64"}
        />

        <View className={isTablet ? "flex-1" : ""}>
          <Card className="gap-3">
            <ScanResultCard scan={last} lookup={state} />
          </Card>
        </View>
      </View>

      {/* The wedge. Invisible, focused, and the only thing a connected scanner
          types into — see `useKeyboardWedge`. */}
      <TextInput ref={wedge.ref} {...wedge.props} />
    </Screen>
  );
}

/**
 * What the last scan was, in words.
 *
 * Split out because the states are the interesting part of this screen and a
 * ternary ladder hides them: nothing yet, another Carbon's code, a route we
 * navigated to, a code still resolving, a lookup that failed, a serial or lot,
 * a part, and a code that matches nothing. A failed LOOKUP and a code that
 * matches NOTHING are deliberately different: the first is our problem and the
 * second is the label's.
 */
function ScanResultCard({
  scan,
  lookup
}: {
  scan: ScanResult | null;
  lookup: ScanLookupState;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";

  if (scan === null) {
    return (
      <Muted>
        <Trans>Nothing scanned yet.</Trans>
      </Muted>
    );
  }

  if (scan.kind === "other-instance") {
    const host = scan.host;
    return (
      <>
        <ErrorNote>
          {t`That code was printed by ${host}, which is not the Carbon this tablet is linked to.`}
        </ErrorNote>
        <Muted className="text-sm">{scan.value}</Muted>
      </>
    );
  }

  if (scan.kind === "url") {
    return (
      <>
        <Body className="font-semibold">
          {scan.route === "picking" ? t`Picking list` : t`Job operation`}
        </Body>
        <Muted className="text-sm">{scan.id}</Muted>
      </>
    );
  }

  if (lookup.status === "pending") {
    return (
      <>
        <Body className="font-semibold">{lookup.code}</Body>
        <Skeleton className="h-6 w-40" />
      </>
    );
  }

  if (lookup.status === "error") {
    return (
      <>
        <Body className="font-semibold">{scan.value}</Body>
        <ErrorNote>{lookup.message}</ErrorNote>
      </>
    );
  }

  if (lookup.status === "done" && lookup.result.kind === "tracked-entity") {
    const entity = lookup.result;
    const quantity = formatQuantity(entity.quantity, locale);
    const part = entity.item;
    return (
      <>
        <Body className="font-semibold">{entity.label}</Body>
        <StatusBadge entity="trackedEntity" status={entity.status} />
        <Muted className="text-sm">
          {part
            ? t`${quantity} × ${part.readableId} — ${part.name}`
            : t`Quantity ${quantity}`}
        </Muted>
      </>
    );
  }

  if (lookup.status === "done" && lookup.result.kind === "item") {
    const item = lookup.result;
    return (
      <>
        <Body className="font-semibold">{item.readableId}</Body>
        <Muted className="text-sm">{t`${item.name} — ${item.type}`}</Muted>
      </>
    );
  }

  return (
    <>
      <Body className="font-semibold">{t`Nothing matches ${scan.value}`}</Body>
      <Muted className="text-sm">
        <Trans>No serial, lot or part on this Carbon has that code.</Trans>
      </Muted>
    </>
  );
}
