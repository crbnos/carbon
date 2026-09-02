import { GOOGLE_OAUTH_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { startIntegrationConnect } from "../integrations/connect";
import { pieceLogo } from "../integrations/piece-logo";

/** The card's id IS the Activepieces piece name, which is what lets the connect
 * route, the uninstall hook and the workflow catalog all address it as one thing. */
const PIECE = "google-calendar";

/**
 * Google Calendar, as an ordinary integration card.
 *
 * The steps it adds to a workflow come from an Activepieces piece, but nothing
 * about that is visible here: installing it connects a Google account, and the
 * card's Details drawer manages however many accounts the company has connected.
 * `id` deliberately matches the piece name, so no lookup table is needed to get
 * from one to the other.
 */
export const GoogleCalendar = defineIntegration({
  name: "Google Calendar",
  id: PIECE,
  category: "Productivity",
  // Unset OAuth credentials render the card "Coming soon" rather than offering an
  // Install that could only fail.
  active: !!GOOGLE_OAUTH_CLIENT_ID,
  logo: pieceLogo(PIECE),
  shortDescription: "Create and read calendar events from your workflows.",
  description:
    "Connect a Google account so your workflows can create and read Google Calendar events. Connect more than one account if different workflows should act as different calendars.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: () =>
    startIntegrationConnect(`/api/integrations/connections/${PIECE}/connect`)
});
