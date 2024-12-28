import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { transpile } from "https://deno.land/x/ts_transpiler@v0.0.2/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { corsHeaders } from "../lib/headers.ts";

const payloadValidator = z.object({
  code: z.string(),
  parameters: z.record(z.unknown()),
});

async function ts(code: string) {
  try {
    // Transpile TypeScript to JavaScript
    const jsCode = await transpile(
      `export function configure(params: Params) {${code}}`
    );

    return await import(`data:application/typescript;base64,${btoa(jsCode)}`);
  } catch (err) {
    console.error("Transpilation error:", err);
    throw new Error(`Failed to transpile TypeScript: ${err.message}`);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { code, parameters } = payloadValidator.parse(payload);

    console.log({
      function: "sandbox",
      code,
      parameters,
    });

    let result;
    try {
      const mod = await ts(code);
      console.log({ mod });
      result = await mod.configure(parameters);
      console.log({ result });
    } catch (err) {
      console.error("Execution error:", err);
      throw new Error(`Failed to execute code: ${err.message}`);
    }

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
