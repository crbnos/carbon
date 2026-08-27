import { GOOGLE_OAUTH_CLIENT_ID } from "@carbon/auth";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

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
  id: "google-calendar",
  category: "Productivity",
  // Unset OAuth credentials render the card "Coming soon" rather than offering an
  // Install that could only fail.
  active: !!GOOGLE_OAUTH_CLIENT_ID,
  logo: Logo,
  shortDescription: "Create and read calendar events from your workflows.",
  description:
    "Connect a Google account so your workflows can create and read Google Calendar events. Connect more than one account if different workflows should act as different calendars.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: async () => {
    const response = await fetch(
      "/api/integrations/connections/google-calendar/connect"
    ).then((res) => res.json());

    const { url, error } = response;
    if (!url) {
      throw new Error(error ?? "Couldn't start the Google authorization.");
    }

    const width = 600;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2.5;

    const popup = window.open(
      url,
      "",
      `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${width}, height=${height}, top=${top}, left=${left}`
    );

    if (!popup) {
      window.location.href = url;
    }
  }
});

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Google Calendar"
      {...props}
    >
      <path d="M152 48H48v104h104V48z" fill="#ffffff" />
      <path d="M152 200l48-48h-48v48z" fill="#ea4335" />
      <path d="M200 48h-48v104h48V48z" fill="#fbbc04" />
      <path d="M152 152H48v48h104v-48z" fill="#34a853" />
      <path d="M0 152v32c0 8.84 7.16 16 16 16h32v-48H0z" fill="#188038" />
      <path d="M200 48V16c0-8.84-7.16-16-16-16h-32v48h48z" fill="#1967d2" />
      <path d="M152 0H16C7.16 0 0 7.16 0 16v136h48V48h104V0z" fill="#4285f4" />
      <text
        x="100"
        y="132"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="72"
        fontWeight="700"
        fill="#4285f4"
      >
        31
      </text>
    </svg>
  );
}
