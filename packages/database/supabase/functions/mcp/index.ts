import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsHeaders } from "../lib/headers.ts";
import { createMcp } from "../lib/mcp.ts";
import { salesTools } from "./sales.tools.ts";

const tools = [...salesTools]

const mcp = createMcp({ tools })

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  console.log({ function: "mcp", ...payload });
  
  try {
    const result = await mcp.process(payload);
    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(error), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
