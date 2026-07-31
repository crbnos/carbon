import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { sendInngestEvent } from "../lib/inngest.ts";

const recipientValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user"),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("group"),
    groupIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("users"),
    userIds: z.array(z.string()),
  }),
]);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    event: z.enum([
      "job-completed",
      "quote-assignment",
      "sales-rfq-assignment",
      "sales-order-assignment",
    ]),
    documentId: z.string(),
    companyId: z.string(),
    recipient: recipientValidator,
    from: z.string().optional(),
  }),
]);

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  const payload = await req.json();

  try {
    const validatedPayload = payloadValidator.parse(payload);
    const { type, ...data } = validatedPayload;

    console.log({
      function: "trigger",
      type,
      ...data,
    });

    switch (type) {
      case "notify": {
        await sendInngestEvent("carbon/notify", {
          companyId: data.companyId,
          documentId: data.documentId,
          event: data.event,
          recipient: data.recipient,
          from: data.from ?? "system",
        });
        break;
      }

      default:
        throw new Error(`Invalid type  ${type}`);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
