import { Font } from "@react-pdf/renderer";

/**
 * Google fonts offered in the template editor, registered on demand at render
 * time. Inter is registered statically in Template; Helvetica / Times-Roman /
 * Courier are PDF standard fonts and need no registration.
 *
 * react-pdf can render TTF/WOFF but NOT WOFF2, so we fetch the CSS2 stylesheet
 * with a legacy User-Agent that makes Google serve TTF `src` URLs, then parse
 * one TTF per weight and register them.
 */
const GOOGLE_FONTS: Record<string, { family: string; weights: number[] }> = {
  Roboto: { family: "Roboto", weights: [400, 700] },
  "Open Sans": { family: "Open Sans", weights: [400, 700] },
  Lato: { family: "Lato", weights: [400, 700] },
  Montserrat: { family: "Montserrat", weights: [400, 700] },
  Merriweather: { family: "Merriweather", weights: [400, 700] },
  "Playfair Display": { family: "Playfair Display", weights: [400, 700] },
  Lora: { family: "Lora", weights: [400, 700] }
};

// IE6 UA — Google serves plain TTF (no woff/woff2) to it.
const TTF_USER_AGENT = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)";

const done = new Set<string>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Ensure `family` is registered with react-pdf before rendering. No-op for
 * built-ins, Inter, or unknown families. Best-effort: on any failure the font
 * is simply left unregistered (Template falls back to a safe font).
 */
export async function ensureFont(family: string): Promise<void> {
  const meta = GOOGLE_FONTS[family];
  if (!meta || done.has(family)) return;

  let pending = inFlight.get(family);
  if (!pending) {
    pending = registerGoogleFont(meta)
      .catch(() => {
        // Font load failure is non-fatal; PDF falls back to the default face.
      })
      .finally(() => {
        done.add(family);
        inFlight.delete(family);
      });
    inFlight.set(family, pending);
  }
  return pending;
}

async function registerGoogleFont(meta: {
  family: string;
  weights: number[];
}): Promise<void> {
  const url = `https://fonts.googleapis.com/css2?family=${meta.family.replace(
    / /g,
    "+"
  )}:wght@${meta.weights.join(";")}`;

  const res = await fetch(url, { headers: { "User-Agent": TTF_USER_AGENT } });
  if (!res.ok) return;
  const css = await res.text();

  // CSS2 emits one or more @font-face per weight (split by unicode-range);
  // keep the first TTF src for each weight.
  const fonts: { src: string; fontWeight: number }[] = [];
  const seen = new Set<number>();
  const re =
    /font-weight:\s*(\d+);[\s\S]*?src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+?\.ttf)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const weight = Number(match[1]);
    if (seen.has(weight)) continue;
    seen.add(weight);
    fonts.push({ src: match[2]!, fontWeight: weight });
  }

  if (fonts.length > 0) {
    Font.register({ family: meta.family, fonts });
  }
}
