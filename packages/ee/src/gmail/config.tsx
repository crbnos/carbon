import { GOOGLE_OAUTH_CLIENT_ID } from "@carbon/auth";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { startIntegrationConnect } from "../integrations/connect";

/** The card's id IS the Activepieces piece name — see google-calendar/config.tsx. */
const PIECE = "gmail";

/**
 * Gmail, as an ordinary integration card, on the same Google OAuth app as Google
 * Calendar. Each connected account sends as itself. The consent asks ONLY for
 * permission to send (`gmail.send`) — never to read the mailbox — which is what
 * keeps the app out of Google's restricted-scope tier.
 */
export const Gmail = defineIntegration({
  name: "Gmail",
  id: PIECE,
  category: "Email",
  // Unset OAuth credentials render the card "Coming soon" rather than offering an
  // Install that could only fail.
  active: !!GOOGLE_OAUTH_CLIENT_ID,
  logo: Logo,
  shortDescription:
    "Send email from your workflows using a connected Google account.",
  description:
    "Connect a Google account so your workflows can send email as that account. Carbon only asks for permission to send, never to read the mailbox. Connect more than one account if different workflows should send as different people.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: () =>
    startIntegrationConnect(`/api/integrations/connections/${PIECE}/connect`)
});

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 36"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Gmail"
      {...props}
    >
      <path
        d="M3.27 36h7.64V17.45L0 9.27v23.46A3.27 3.27 0 0 0 3.27 36z"
        fill="#4285f4"
      />
      <path
        d="M37.09 36h7.64A3.27 3.27 0 0 0 48 32.73V9.27l-10.91 8.18V36z"
        fill="#34a853"
      />
      <path
        d="M37.09 3.27v14.18L48 9.27V4.91c0-4.05-4.62-6.36-7.85-3.93l-3.06 2.29z"
        fill="#fbbc04"
      />
      <path
        d="M10.91 17.45V3.27L24 13.09 37.09 3.27v14.18L24 27.27 10.91 17.45z"
        fill="#ea4335"
      />
      <path
        d="M0 4.91v4.36l10.91 8.18V3.27L7.85.98C4.62-1.45 0 .86 0 4.91z"
        fill="#c5221f"
      />
    </svg>
  );
}
