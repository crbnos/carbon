import { GOOGLE_OAUTH_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { startIntegrationConnect } from "../integrations/connect";
import { pieceLogo } from "../integrations/piece-logo";

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
  logo: pieceLogo(PIECE),
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
