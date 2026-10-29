// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { GOOGLE_CLIENT_ID } from "@carbon/auth";
import { definePieceIntegration } from "../integrations/piece-integration";

/**
 * Google Calendar, as an ordinary integration card.
 *
 * The steps it adds to a workflow come from an Activepieces piece, but nothing
 * about that is visible here: installing it connects a Google account, and the
 * card's Details drawer manages however many accounts the company has connected.
 */
export const GoogleCalendar = definePieceIntegration("google-calendar", {
  name: "Google Calendar",
  category: "Productivity",
  // Unset OAuth credentials render the card "Coming soon" rather than offering an
  // Install that could only fail.
  active: !!GOOGLE_CLIENT_ID,
  shortDescription: "Create and read calendar events from your workflows.",
  description:
    "Connect a Google account so your workflows can create and read Google Calendar events. Connect more than one account if different workflows should act as different calendars."
});
