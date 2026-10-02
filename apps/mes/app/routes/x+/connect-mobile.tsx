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
  SidebarTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuSmartphone, LuWifi } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

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
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-card">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">
            <Trans>Connect Mobile App</Trans>
          </Heading>
        </div>
      </header>

      <main className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <VStack spacing={4} className="p-4 w-full max-w-2xl mx-auto">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LuSmartphone /> <Trans>Scan to connect</Trans>
              </CardTitle>
              <CardDescription className="text-sm">
                <Trans>
                  Install Carbon MES from the App Store or Google Play, then
                  scan this code.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack spacing={4} className="items-center">
                {/* QR codes are drawn with a transparent background, so the
                    light plate is what keeps them scannable in dark mode. */}
                <div className="rounded-lg bg-white p-4">
                  <img
                    alt={t`QR code linking the Carbon MES app to ${serverUrl}`}
                    className="size-64"
                    src={qrCode}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base select-all break-all">
                    {serverUrl}
                  </span>
                  <Copy
                    label={t`Copy server address`}
                    size="lg"
                    text={serverUrl}
                  />
                </div>
                <p className="text-muted-foreground text-sm text-center">
                  <Trans>
                    Or type the address on the app's Connect screen.
                  </Trans>
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
                  localhost, which a phone on the same network cannot open. Type
                  the Mac's LAN address on the app's Connect screen instead —
                  for example http://192.168.1.100:3001.
                </Trans>
              </AlertDescription>
            </Alert>
          )}
        </VStack>
      </main>
    </div>
  );
}
