// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getMESUrl, IS_LOCAL_DEV } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { generateQRCode } from "@carbon/documents/qr";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Copy,
  Heading,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuSmartphone, LuWifi } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Connect Mobile App`,
  to: path.to.connectMobile
};

// bwip-js measures in millimetres, not pixels: 128 renders a 693px PNG, which
// stays sharp at the 256px the page draws it at, including on a 2x display.
const QR_SIZE = 128;

export async function loader({ request }: LoaderFunctionArgs) {
  // Any signed-in employee — the server's public address is not a secret.
  await requirePermissions(request, {});

  const serverUrl = getMESUrl();
  const qrCode = await generateQRCode(
    `carbon-mes://link?server=${encodeURIComponent(serverUrl)}`,
    QR_SIZE
  );

  return { isLocalDev: IS_LOCAL_DEV, qrCode, serverUrl };
}

export default function ConnectMobileRoute() {
  const { t } = useLingui();
  const { isLocalDev, qrCode, serverUrl } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={4} className="p-8 w-full max-w-4xl mx-auto">
      <VStack spacing={1}>
        <Heading size="h3">
          <Trans>Connect Mobile App</Trans>
        </Heading>
        <p className="text-muted-foreground text-sm">
          <Trans>
            Point the Carbon MES app at this server so the shop floor can clock
            in, pick and report from a phone or tablet.
          </Trans>
        </p>
      </VStack>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LuSmartphone /> <Trans>Scan to connect</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Install Carbon MES from the App Store or Google Play, then scan
              this code.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VStack spacing={4} className="items-center">
            {/* QR codes are drawn with a transparent background, so the light
                plate is what keeps them scannable in dark mode. */}
            <div className="rounded-lg bg-white p-4">
              <img
                alt={t`QR code linking the Carbon MES app to ${serverUrl}`}
                className="size-64"
                src={qrCode}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm select-all break-all">
                {serverUrl}
              </span>
              <Copy label={t`Copy server address`} text={serverUrl} />
            </div>
            <p className="text-muted-foreground text-xs text-center">
              <Trans>Or type the address on the app's Connect screen.</Trans>
            </p>
          </VStack>
        </CardContent>
      </Card>

      {isLocalDev && (
        <Alert variant="warning">
          <LuWifi />
          <AlertTitle>
            <Trans>A phone cannot reach this address</Trans>
          </AlertTitle>
          <AlertDescription>
            <Trans>
              In local development the address above is this Mac's own
              localhost, which a phone on the same network cannot open. Type the
              Mac's LAN address on the app's Connect screen instead — for
              example http://192.168.1.100:3001.
            </Trans>
          </AlertDescription>
        </Alert>
      )}
    </VStack>
  );
}
