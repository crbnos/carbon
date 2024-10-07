import { getThemeCode, themes } from "@carbon/utils";
import type { LoaderFunctionArgs } from "@vercel/remix";

// export const config = { runtime: "nodejs" };

export async function loader({ request }: LoaderFunctionArgs) {
  const selectedTheme = themes.find((t) => t.name === "zinc");

  if (!selectedTheme) {
    return new Response("", {
      headers: {
        "Content-Type": "text/css",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const css = getThemeCode(selectedTheme);

  return new Response(css, {
    headers: {
      "Content-Type": "text/css",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
