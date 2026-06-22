import { ImageResponse } from "next/og";

export const alt = "Carbon";
export const contentType = "image/png";

/**
 * Dynamic Open Graph card — `/og?title=…&eyebrow=…`. Rendered with the editorial
 * warm-paper palette and our display font (DM Sans), matching the site.
 *
 * Satori needs a TrueType/OTF/WOFF buffer (not woff2, which is all next/font emits),
 * so DM Sans is fetched at request time: Google's css2 endpoint serves a `truetype`
 * src when the request is subset by `text=` and not announced as woff2-capable. The
 * result is cached immutably per URL, so the fetch happens once per (title, eyebrow).
 */
async function loadDmSans(weight: number, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=DM+Sans:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const src =
    css.match(
      /src:\s*url\((https:[^)]+)\)\s*format\(['"]?truetype['"]?\)/
    )?.[1] ?? css.match(/src:\s*url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!src) throw new Error("Failed to resolve DM Sans TrueType source");
  return (await fetch(src)).arrayBuffer();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get("title") || "Carbon Docs").slice(0, 110);
  const eyebrow = (searchParams.get("eyebrow") || "Documentation")
    .slice(0, 40)
    .toUpperCase();

  // Subset the font to just the glyphs this card draws.
  const glyphs = `${title}${eyebrow}Carbon carbon.ms`;
  const [semibold, regular] = await Promise.all([
    loadDmSans(600, glyphs),
    loadDmSans(400, glyphs)
  ]);

  const titleSize = title.length > 70 ? 54 : title.length > 44 ? 62 : 74;

  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "76px 80px",
        background: "#FFFFFF",
        fontFamily: "DM Sans"
      }}
    >
      {/* Hairline inset frame */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: 24,
          right: 24,
          bottom: 24,
          border: "1px solid #E2E1DD",
          borderRadius: 24
        }}
      />

      {/* Brand mark — a soft decorative accent balancing the wordmark */}
      <svg
        width={300}
        height={340}
        viewBox="0 0 424 480"
        fill="none"
        style={{ position: "absolute", top: 30, right: -36 }}
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M176.24 9.80407C198.287 -3.26801 225.714 -3.26803 247.761 9.80407L389.658 93.9389C410.947 106.562 424 129.472 424 154.217V325.783C424 350.528 410.947 373.439 389.658 386.062L247.761 470.196C225.714 483.268 198.287 483.268 176.24 470.196L34.3432 386.062C13.0539 373.439 0.000129963 350.528 0 325.783V154.217C0.000219136 129.472 13.054 106.562 34.3432 93.9389L176.24 9.80407ZM224.561 112.025C217.155 107.562 207.886 107.551 200.471 111.999L124.056 157.836C108.898 166.929 108.938 188.904 124.128 197.943L200.899 243.618C202.762 244.727 203.903 246.734 203.903 248.901V339.17C203.903 357.314 223.69 368.532 239.265 359.22L314.442 314.275C321.496 310.057 325.815 302.443 325.815 294.225V186.253C325.815 178.065 321.527 170.474 314.514 166.246L224.561 112.025Z"
          fill="#DCEEF7"
        />
      </svg>

      {/* Brand lockup */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <svg width={44} height={50} viewBox="0 0 424 480" fill="none">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M176.24 9.80407C198.287 -3.26801 225.714 -3.26803 247.761 9.80407L389.658 93.9389C410.947 106.562 424 129.472 424 154.217V325.783C424 350.528 410.947 373.439 389.658 386.062L247.761 470.196C225.714 483.268 198.287 483.268 176.24 470.196L34.3432 386.062C13.0539 373.439 0.000129963 350.528 0 325.783V154.217C0.000219136 129.472 13.054 106.562 34.3432 93.9389L176.24 9.80407ZM224.561 112.025C217.155 107.562 207.886 107.551 200.471 111.999L124.056 157.836C108.898 166.929 108.938 188.904 124.128 197.943L200.899 243.618C202.762 244.727 203.903 246.734 203.903 248.901V339.17C203.903 357.314 223.69 368.532 239.265 359.22L314.442 314.275C321.496 310.057 325.815 302.443 325.815 294.225V186.253C325.815 178.065 321.527 170.474 314.514 166.246L224.561 112.025Z"
            fill="#262323"
          />
        </svg>
        <div
          style={{
            marginLeft: 18,
            fontSize: 40,
            fontWeight: 600,
            color: "#262323"
          }}
        >
          Carbon
        </div>
      </div>

      {/* Title block */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: 4,
            color: "#1E84B0"
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.1,
            color: "#262323",
            maxWidth: 1000
          }}
        >
          {title}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div
          style={{ fontSize: 25, fontWeight: 400, color: "rgba(38,35,35,0.5)" }}
        >
          carbon.ms
        </div>
        <div style={{ display: "flex" }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: "#00B0FF"
            }}
          />
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              marginLeft: 8,
              background: "rgba(38,35,35,0.18)"
            }}
          />
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              marginLeft: 8,
              background: "rgba(38,35,35,0.18)"
            }}
          />
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "DM Sans", data: semibold, weight: 600, style: "normal" },
        { name: "DM Sans", data: regular, weight: 400, style: "normal" }
      ],
      headers: { "cache-control": "public, max-age=31536000, immutable" }
    }
  );
}
