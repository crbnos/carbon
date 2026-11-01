// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { GOOGLE_CLIENT_ID } from "@carbon/auth";
import { definePieceIntegration } from "../integrations/piece-integration";

/**
 * Gmail, as an ordinary integration card, on the same Google OAuth app as Google
 * Calendar. Each connected account sends as itself. The consent asks ONLY for
 * permission to send (`gmail.send`) — never to read the mailbox — which is what
 * keeps the app out of Google's restricted-scope tier.
 */
export const Gmail = definePieceIntegration("gmail", {
  name: "Gmail",
  category: "Email",
  // Unset OAuth credentials render the card "Coming soon" rather than offering an
  // Install that could only fail.
  active: !!GOOGLE_CLIENT_ID,
  shortDescription:
    "Send email from your workflows using a connected Google account.",
  description:
    "Connect a Google account so your workflows can send email as that account. Carbon only asks for permission to send, never to read the mailbox. Connect more than one account if different workflows should send as different people."
});
