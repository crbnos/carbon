import { getAppUrl } from "@carbon/auth";
import { tool } from "ai";
import { LuSearch } from "react-icons/lu";
import { z } from "zod";
import { generateEmbedding } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";
import type { ChatContext } from "../agents/shared/context";
import type { ToolConfig } from "../agents/shared/tools";
import { getSuppliersForParts } from "./get-supplier-for-parts";

export const config: ToolConfig = {
  name: "getSupplier",
  icon: LuSearch,
  displayText: "Getting Supplier",
  message: "Searching for a supplier..."
};

export const getSupplierSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    partIds: z.array(z.string()).optional()
  })
  .refine((data) => data.id || data.name || data.description || data.partIds, {
    message: "Either id, name, description, orpartIds must be provided"
  });

export const getSupplierTool = tool({
  description:
    "Search for suppliers by a specific name as specified by the user, a deduced description, or a list of part ids",
  inputSchema: getSupplierSchema,
  execute: async function (args, executionOptions) {
    const context = executionOptions.experimental_context as ChatContext;
    let { name, description, partIds } = args;

    if (args.id) {
      const supplier = await context.client
        .from("supplier")
        .select("*")
        .eq("id", args.id)
        .eq("companyId", context.companyId)
        .single();

      if (supplier.data) {
        return {
          link: `${getAppUrl()}${path.to.supplier(supplier.data.id)}`,
          id: supplier.data.id,
          name: supplier.data.name
        };
      }
    }

    if (partIds && partIds.length > 0) {
      return getSuppliersForParts(context.client, partIds, context);
    }

    if (args.name) {
      const supplier = await context.client
        .from("supplier")
        .select("*")
        .eq("name", args.name)
        .eq("companyId", context.companyId)
        .single();

      if (supplier.data) {
        return {
          id: supplier.data.id
        };
      }
      if (!description) {
        description = name;
      }
    }

    if (description) {
      const embedding = await generateEmbedding(description);

      const search = await context.client.rpc("suppliers_search", {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.8,
        match_count: 10,
        p_company_id: context.companyId
      });

      if (search.data && search.data.length > 0) {
        return search.data;
      }
    }

    return null;
  }
});
