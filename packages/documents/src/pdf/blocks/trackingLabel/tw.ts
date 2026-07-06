import { createTw } from "react-pdf-tailwind";

/** Tailwind instance for tracking-label blocks (matches ProductLabelPDF). */
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
