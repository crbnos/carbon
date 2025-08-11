import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { tasks } from "npm:@trigger.dev/sdk@3.0.0/v3";
import { z } from "npm:zod@^3.24.1";
import {
  slackDocumentAssignmentUpdate,
  slackDocumentCreated,
  slackDocumentStatusUpdate,
  slackDocumentTaskUpdate,
} from "../../../../jobs/trigger/slack-document-sync.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const documentTypeSchema = z.enum([
  "nonConformance",
  "quote",
  "salesOrder",
  "job",
  "purchaseOrder",
  "invoice",
  "receipt",
  "shipment",
]);

type DocumentType = z.infer<typeof documentTypeSchema>;

const metadataSchema = z.record(z.unknown()).optional();

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("created"),
    documentType: documentTypeSchema,
    documentId: z.string(),
    companyId: z.string(),
    channelId: z.string(),
    threadTs: z.string(),
    payload: z
      .object({
        metadata: metadataSchema,
      })
      .optional(),
  }),
  z.object({
    type: z.literal("status-update"),
    documentType: documentTypeSchema,
    documentId: z.string(),
    companyId: z.string(),
    payload: z.object({
      previousStatus: z.string(),
      newStatus: z.string(),
      updatedBy: z.string(),
      metadata: metadataSchema,
    }),
  }),
  z.object({
    type: z.literal("task-update"),
    documentType: documentTypeSchema,
    documentId: z.string(),
    companyId: z.string(),
    payload: z.object({
      taskType: z.enum(["investigation", "action", "approval"]),
      taskName: z.string(),
      status: z.string(),
      assignedTo: z.string().optional(),
      completedBy: z.string().optional(),
      completedAt: z.string().optional(),
      notes: z.string().optional(),
      metadata: metadataSchema,
    }),
  }),
  z.object({
    type: z.literal("assignment-update"),
    documentType: documentTypeSchema,
    documentId: z.string(),
    companyId: z.string(),
    payload: z.object({
      previousAssignee: z.string().optional(),
      newAssignee: z.string(),
      updatedBy: z.string(),
      metadata: metadataSchema,
    }),
  }),
  z.object({
    type: z.literal("custom"),
    documentType: documentTypeSchema,
    documentId: z.string(),
    companyId: z.string(),
    payload: z.object({
      customType: z.string(),
      data: z.record(z.unknown()),
    }),
  }),
]);

type ValidatedPayload = z.infer<typeof payloadValidator>;

interface SlackIntegrationMetadata {
  access_token?: string;
  [key: string]: unknown;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validatedPayload = payloadValidator.parse(body);
    const { type, documentType, documentId, companyId, payload, ...otherData } =
      validatedPayload;

    console.log({
      function: "slack-document-sync",
      type,
      documentType,
      documentId,
      companyId,
    });

    // Check if Slack integration is enabled for this company
    const serviceRole = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const { data: integration } = await serviceRole
      .from("companyIntegration")
      .select("metadata")
      .eq("companyId", companyId)
      .eq("active", true)
      .single();

    if (!integration?.metadata) {
      console.log("Slack integration not active for company", companyId);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Slack integration not active",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const metadata = integration.metadata as SlackIntegrationMetadata;

    // Check if notifications are enabled for this document type
    const notificationKey = `${documentType}_notifications_enabled`;
    if (metadata[notificationKey] === false) {
      console.log(
        `${documentType} notifications disabled for company`,
        companyId
      );
      return new Response(
        JSON.stringify({
          success: true,
          message: `${documentType} notifications disabled`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Trigger the appropriate Trigger.dev job
    switch (type) {
      case "created": {
        const createdData = otherData as Extract<
          ValidatedPayload,
          { type: "created" }
        >;
        await tasks.trigger<typeof slackDocumentCreated>(
          "slack-document-created",
          {
            documentType,
            documentId,
            companyId,
            channelId: createdData.channelId,
            threadTs: createdData.threadTs,
          }
        );
        break;
      }

      case "status-update":
        await tasks.trigger<typeof slackDocumentStatusUpdate>(
          "slack-document-status-update",
          {
            documentType,
            documentId,
            companyId,
            ...payload,
          }
        );
        break;

      case "task-update":
        await tasks.trigger<typeof slackDocumentTaskUpdate>(
          "slack-document-task-update",
          {
            documentType,
            documentId,
            companyId,
            ...payload,
          }
        );
        break;

      case "assignment-update":
        await tasks.trigger<typeof slackDocumentAssignmentUpdate>(
          "slack-document-assignment-update",
          {
            documentType,
            documentId,
            companyId,
            ...payload,
          }
        );
        break;

      case "custom":
        // For now, just log custom updates
        console.log(`Custom update for ${documentType}:`, payload);
        break;

      default:
        throw new Error(`Invalid type ${type}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("slack-document-sync error:", err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
