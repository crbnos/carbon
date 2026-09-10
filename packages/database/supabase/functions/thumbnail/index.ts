import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import puppeteer from "npm:puppeteer-core@16.2.0";
import { z } from "npm:zod@^4.5.4";
import { Buffer } from "node:buffer";
import { corsHeaders } from "../lib/headers.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { corsPreflight, errorResponse } from "../lib/response.ts";

import {
  ImageMagick,
  MagickColor,
  MagickFormat,
  initializeImageMagick,
} from "npm:@imagemagick/magick-wasm@0.0.30";

const logger = getFunctionLogger("thumbnail");

const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30")
  )
);
await initializeImageMagick(wasmBytes);

const payloadSchema = z.object({
  url: z.string(),
});

// Remote browserless in prod; a local Chromium container (ws://chrome:3000) in
// dev via BROWSERLESS_WS_URL, so the thumbnail flow is testable end-to-end locally.
const browserWSEndpoint =
  Deno.env.get("BROWSERLESS_WS_URL") ??
  `ws://5.161.255.30?token=59ecf910-aaa8-4c7e-aedb-7c18b34e266e`;

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  let browser;
  try {
    const payload = await req.json();
    const { url } = payloadSchema.parse(payload);

    logger.info({ url });

    browser = await puppeteer.connect({
      browserWSEndpoint,
      // Locally the target is the portless erp host (self-signed CA); prod uses a
      // valid cert so this is a no-op there.
      ignoreHTTPSErrors: true,
    });
    logger.debug("browser connected");
    const page = await browser.newPage();
    logger.debug("page created");
    await page.setViewport({ width: 1000, height: 1000 });
    logger.debug("viewport set");
    await page.goto(url);
    logger.debug(`navigated to ${url}`);
    // Wait for the canvas with id=viewer to be visible, but no longer than 5 seconds
    await page.waitForSelector("#model-viewer-canvas", {
      timeout: 10000,
    });
    logger.debug("model-viewer-canvas visible");
    // Capture just the center portion of the viewport to avoid the ring
    const screenshot = await page.screenshot({
      encoding: "binary",
      clip: { x: 15, y: 15, width: 960, height: 960 },
    });

    const screenshotArray = new Uint8Array(
      typeof screenshot === "string"
        ? Buffer.from(screenshot, "utf-8")
        : screenshot
    );

    const result = await ImageMagick.read(screenshotArray, (img) => {
      img.transparent(new MagickColor("white"));

      img.resize(300, 300);
      // Set the output format explicitly and COPY the bytes out of the callback:
      // the `data` handed to `write` is a view into ImageMagick's WASM heap that is
      // reused/freed once the callback returns — returning it directly yields a
      // corrupt PNG (valid header, garbage body → "200 but invalid image").
      img.format = MagickFormat.Png;
      return img.write((data) => new Uint8Array(data));
    });

    return new Response(result, {
      headers: { ...corsHeaders, "Content-Type": "image/png" },
      status: 200,
    });
  } catch (err) {
    return errorResponse(err, 400);
  } finally {
    if (browser) {
      await browser.close();
      logger.debug("browser closed");
    }
  }
});
