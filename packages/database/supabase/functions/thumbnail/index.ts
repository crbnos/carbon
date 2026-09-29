// Screenshots a model in the viewer and returns a 300×300 PNG thumbnail.
// Self-contained: nothing is imported from outside this directory.
import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import decodePng from "npm:@jsquash/png@3.1.1/decode.js";
import encodePng from "npm:@jsquash/png@3.1.1/encode.js";
import resize from "npm:@jsquash/resize@2.1.1";
import puppeteer from "npm:puppeteer-core@16.2.0";
import { z } from "npm:zod@^4.5.4";
import { Buffer } from "node:buffer";
import { decodeJwt, jwtVerify } from "npm:jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const errorResponse = (message: string, status: number) =>
  new Response(JSON.stringify({ message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

/** With JWT_SECRET set (self-host, local dev) the signature is verified here;
 *  on Supabase Cloud the gateway already verified it. */
async function isServiceRole(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return false;
  if (token === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim()) {
    return true;
  }
  if (token.split(".").length !== 3) return false;
  try {
    const secret = Deno.env.get("JWT_SECRET");
    const claims = secret
      ? (await jwtVerify(token, new TextEncoder().encode(secret))).payload
      : decodeJwt(token);
    return claims.role === "service_role";
  } catch {
    return false;
  }
}

/** It drives a browser to whatever URL it is handed: the service role only. */
async function requireServiceRole(req: Request): Promise<void> {
  if (!(await isServiceRole(req))) throw new Error("Service role only");
}

const payloadSchema = z.object({
  url: z.string(),
});

// Remote browserless in prod; a local Chromium container (ws://chrome:3000) in
// dev via BROWSERLESS_WS_URL, so the thumbnail flow is testable end-to-end locally.
const browserWSEndpoint =
  Deno.env.get("BROWSERLESS_WS_URL") ??
  `ws://5.161.255.30?token=59ecf910-aaa8-4c7e-aedb-7c18b34e266e`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    await requireServiceRole(req);
  } catch (err) {
    return errorResponse((err as Error).message, 401);
  }

  let browser;
  try {
    const payload = await req.json();
    const { url } = payloadSchema.parse(payload);

    console.info("thumbnail", { url });

    browser = await puppeteer.connect({
      browserWSEndpoint,
      // Locally the target is the portless erp host (self-signed CA); prod uses a
      // valid cert so this is a no-op there.
      ignoreHTTPSErrors: true,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1000 });
    await page.goto(url);
    // Wait for the canvas with id=viewer to be visible, but no longer than 5 seconds
    await page.waitForSelector("#model-viewer-canvas", {
      timeout: 10000,
    });
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

    const image = await decodePng(screenshotArray.slice().buffer);
    // Knock the white viewer background out to transparency, as magick's
    // `transparent(white)` did.
    for (let i = 0; i < image.data.length; i += 4) {
      if (
        image.data[i] === 255 &&
        image.data[i + 1] === 255 &&
        image.data[i + 2] === 255
      ) {
        image.data[i + 3] = 0;
      }
    }
    const resized = await resize(image, {
      width: 300,
      height: 300,
      fitMethod: "stretch",
    });
    const result = new Uint8Array(await encodePng(resized));

    return new Response(result as BodyInit, {
      headers: { ...corsHeaders, "Content-Type": "image/png" },
      status: 200,
    });
  } catch (err) {
    console.error("thumbnail failed", err);
    return errorResponse(err instanceof Error ? err.message : "", 400);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});
