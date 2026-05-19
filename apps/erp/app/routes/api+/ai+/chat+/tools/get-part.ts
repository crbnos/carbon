import { tool } from "ai";
import { LuSearch } from "react-icons/lu";
import { z } from "zod";
import { generateEmbedding } from "~/modules/shared/shared.service";
import type { ChatContext } from "../agents/shared/context";
import type { ToolConfig } from "../agents/shared/tools";

export const config: ToolConfig = {
  name: "getPart",
  icon: LuSearch,
  displayText: "Getting Part",
  message: "Searching for a part..."
};

export const getPartSchema = z
  .object({
    readableId: z.string().optional(),
    description: z.string().optional()
  })
  .refine((data) => data.readableId || data.description, {
    message: "Either readableId or description must be provided"
  });

export const getPartTool = tool({
  description: "Search for a part by description or readable id",
  inputSchema: getPartSchema,
  execute: async function (args, executionOptions) {
    const context = executionOptions.experimental_context as ChatContext;
    let { readableId, description } = args;

    console.log("[getPartTool] args:", JSON.stringify(args));
    console.log("[getPartTool] companyId:", context.companyId);

    if (readableId) {
      console.log("[getPartTool] searching by readableId:", readableId);
      const [part, supplierPart] = await Promise.all([
        context.client
          .from("item")
          .select("id, name, description, revision")
          .or(
            `readableId.eq.${readableId},readableIdWithRevision.eq.${readableId}`
          )
          .eq("companyId", context.companyId)
          .order("revision", { ascending: false })
          .limit(1),
        context.client
          .from("supplierPart")
          .select("*, item(id, name, description, revision)")
          .eq("supplierPartId", readableId)
          .eq("companyId", context.companyId)
          .single()
      ]);

      console.log(
        "[getPartTool] item query result:",
        JSON.stringify({ data: part.data, error: part.error })
      );
      console.log(
        "[getPartTool] supplierPart query result:",
        JSON.stringify({ data: supplierPart.data, error: supplierPart.error })
      );

      if (supplierPart.data) {
        console.log("[getPartTool] returning supplierPart match");
        return {
          id: supplierPart.data.itemId,
          name: supplierPart.data.item?.name,
          description: supplierPart.data.item?.description,
          supplierId: supplierPart.data.supplierId
        };
      }
      if (part.data?.[0]) {
        console.log("[getPartTool] returning item match");
        return {
          id: part.data[0].id,
          name: part.data[0].name,
          description: part.data[0].description
        };
      }

      if (!description) {
        console.log(
          "[getPartTool] no direct match found, falling through to embedding search with readableId as description"
        );
        description = readableId;
      } else {
        console.log(
          "[getPartTool] no direct match found for readableId, returning null"
        );
        return null;
      }
    }

    if (description) {
      console.log(
        "[getPartTool] searching by embedding for description:",
        description
      );
      const embedding = await generateEmbedding(description);
      console.log(
        "[getPartTool] embedding generated, length:",
        embedding?.length
      );

      const search = await context.client.rpc("items_search", {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.7,
        match_count: 10,
        p_company_id: context.companyId
      });

      console.log(
        "[getPartTool] embedding search result:",
        JSON.stringify({ data: search.data, error: search.error })
      );

      if (search.data && search.data.length > 0) {
        console.log(
          "[getPartTool] returning",
          search.data.length,
          "embedding matches"
        );
        return search.data;
      }
    }

    console.log("[getPartTool] no results found, returning null");
    return null;
  }
});
