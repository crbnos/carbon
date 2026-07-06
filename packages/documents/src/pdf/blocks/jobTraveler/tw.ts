import { createTw } from "react-pdf-tailwind";

/**
 * Tailwind instance for Job Traveler blocks. Kept identical to the theme
 * previously inlined in JobTravelerPDF so block output is unchanged.
 */
export const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d"
        }
      }
    }
  }
});
