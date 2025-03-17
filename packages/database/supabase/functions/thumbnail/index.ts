import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import { z } from "npm:zod@^3.24.1";
import { Buffer } from "node:buffer";
import { corsHeaders } from "../lib/headers.ts";

import {
  ImageMagick,
  MagickColor,
  initializeImageMagick,
} from "npm:@imagemagick/magick-wasm@0.0.30";

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

const browserWSEndpoint = `ws://5.161.255.30?token=59ecf910-aaa8-4c7e-aedb-7c18b34e266e`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let browser;
  try {
    const payload = await req.json();
    const { url } = payloadSchema.parse(payload);

    console.log({
      function: "thumbnail",
      url,
    });

    browser = await puppeteer.connect({
      browserWSEndpoint,
    });
    console.log("browser connected");
    const page = await browser.newPage();
    console.log("page created");
    await page.setViewport({ width: 1000, height: 1000 });
    console.log("viewport set");
    await page.goto(url);
    console.log(`navigated to ${url}`);
    // Wait for the canvas with id=viewer to be visible, but no longer than 5 seconds
    await page.waitForSelector("#model-viewer-canvas", {
      timeout: 10000,
    });
    console.log("model-viewer-canvas visible");
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
      return img.write((data) => data);
    });

    return new Response(result, {
      headers: { ...corsHeaders, "Content-Type": "image/png" },
      status: 200,
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  } finally {
    if (browser) {
      await browser.close();
      console.log("browser closed");
    }
  }
});
