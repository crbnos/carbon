import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { corsHeaders } from "../lib/headers.ts";

const payloadSchema = z.object({
  url: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { url } = payloadSchema.parse(payload);

    console.log({
      function: "thumbnail",
      url,
    });

    const browserWSEndpoint = `ws://5.161.255.30?token=59ecf910-aaa8-4c7e-aedb-7c18b34e266e`;

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://5.161.255.30?token=59ecf910-aaa8-4c7e-aedb-7c18b34e266e`,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 400 });
    await page.goto(url);

    // // Wait for the canvas with id=viewer to be visible, but no longer than 5 seconds
    // await page.waitForSelector("#model-viewer-canvas", {
    //   timeout: 10000,
    // });

    const screenshot = await page.screenshot({
      encoding: "binary",
      clip: { x: 0, y: 0, width: 400, height: 400 },
    });
    await browser.close();

    return new Response(screenshot, {
      headers: { ...corsHeaders, "Content-Type": "image/png" },
      status: 200,
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
