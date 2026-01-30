import { openai } from "@ai-sdk/openai";
import type { Database } from "@carbon/database";
import {
  getMaterialDescription,
  getMaterialId,
  openAiCategorizationModel,
  supportedModelTypes,
  textToTiptap
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  ComponentChild,
  PaperlessPartsClient,
  QuoteComponent,
  QuoteCostingVariable,
  QuoteItem
} from "./client";
import type {
  AddressSchema,
  ContactSchema,
  FacilitySchema,
  OrderItemSchema,
  OrderSchema,
  SalesPersonSchema
} from "./schemas";
import { calculatePromisedDate } from "./utils";

async function lookupEntityByPaperlessId(
  carbon: SupabaseClient<Database>,
  entityType: string,
  integration: string,
  externalId: string,
  companyId: string
): Promise<string | null> {
  const { data } = await carbon
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("entityType", entityType)
    .eq("integration", integration)
    .eq("externalId", externalId)
    .eq("companyId", companyId)
    .maybeSingle();
  return data?.entityId ?? null;
}

async function createPaperlessMapping(
  carbon: SupabaseClient<Database>,
  entityType: string,
  entityId: string,
  integration: string,
  externalId: string,
  companyId: string
): Promise<void> {
  await carbon
    .from("externalIntegrationMapping")
    .delete()
    .eq("entityType", entityType)
    .eq("entityId", entityId)
    .eq("integration", integration);

  await carbon.from("externalIntegrationMapping").insert({
    entityType,
    entityId,
    integration,
    externalId: String(externalId),
    companyId,
    allowDuplicateExternalId: false
  });
}

/**
 * Strip special characters from filename for safe storage
 */
function stripSpecialCharacters(inputString: string): string {
  // Keep only characters that are valid for S3 keys
  return inputString?.replace(/[^a-zA-Z0-9/!_\-.*'() &$@=;:+,?]/g, "");
}

/**
 * Download file from external URL and convert to File object
 */
async function downloadFileFromUrl(
  url: string,
  filename: string
): Promise<File | null> {
  try {
    console.log(`Downloading file from: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(
        `Failed to download file from ${url}: ${response.statusText}`
      );
      return null;
    }

    const blob = await response.blob();
    const file = new File([blob], filename, { type: blob.type });

    console.log(`Successfully downloaded: ${filename} (${blob.size} bytes)`);
    return file;
  } catch (error) {
    console.error(`Error downloading file from ${url}:`, error);
    return null;
  }
}

/**
 * Check if file extension is a supported model type
 */
function isModelFile(filename: string): boolean {
  const extension = filename.toLowerCase().split(".").pop() || "";
  return supportedModelTypes.includes(extension);
}

const substanceSchema = z.object({
  substanceId: z
    .string()
    .describe("The ID of the best matching material substance"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence level of the match (0-1)"),
  reasoningText: z
    .string()
    .describe("Brief explanation of why this substance was chosen")
});

async function determineMaterialSubstance(
  carbon: SupabaseClient<Database>,
  materialInfo: {
    description: string;
    materialName: string;
    materialDisplayName: string;
    materialFamily: string;
    materialClass: string;
    processName: string;
  }
): Promise<z.infer<typeof substanceSchema> | null> {
  const substances = await carbon
    .from("materialSubstance")
    .select("id, name")
    .is("companyId", null);

  if (substances.error || !substances.data?.length) {
    console.error("Failed to fetch material substances:", substances.error);
    return null;
  }

  try {
    const availableSubstances = substances.data
      .map((s) => `${s.id}: ${s.name}`)
      .join("\n");

    const { object } = await generateObject({
      model: openai(openAiCategorizationModel),
      schema: substanceSchema,
      prompt: `
      Based on the following material information, determine the best matching material substance from the available options.
      
      Material Information:
      - Description: ${materialInfo.description}
      - Material Name: ${materialInfo.materialName}
      - Material Display Name: ${materialInfo.materialDisplayName}
      - Material Family: ${materialInfo.materialFamily}
      - Material Class: ${materialInfo.materialClass}
      - Process Name: ${materialInfo.processName}
      
      Available Material Substances:
      ${availableSubstances}
      
      Select the substance that best matches the material information provided. Consider material type, grade, and common industry terminology.
      `,
      temperature: 0.2
    });

    return object;
  } catch (error) {
    console.error("Failed to determine material substance using AI:", error);
    return null;
  }
}

const materialPropertiesSchema = z.object({
  gradeId: z
    .string()
    .describe("The ID of the best matching material grade")
    .nullable(),
  dimensionId: z
    .string()
    .describe("The ID of the best matching material dimension")
    .nullable(),
  finishId: z
    .string()
    .describe("The ID of the best matching material finish")
    .nullable(),
  typeId: z
    .string()
    .describe("The ID of the best matching material type")
    .nullable(),
  quantity: z.number().describe("The quantity of the material properties"),
  confidence: z.number().describe("Confidence level of the match (0-1)"),
  reasoningText: z
    .string()
    .describe("Brief explanation of why this material properties were chosen")
});

// Cache for material properties by substance ID
type MaterialPropertiesCache = {
  grades: Array<{ id: string; name: string }>;
  dimensions: Array<{ id: string; name: string; materialFormId: string }>;
  finishes: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string; code: string }>;
  forms: Array<{ id: string; name: string; code: string }>;
  substance: { id: string; name: string; code: string };
  timestamp: number;
};

const materialPropertiesCache = new Map<string, MaterialPropertiesCache>();

// Cache TTL in milliseconds (30 minutes)
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, value] of materialPropertiesCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      materialPropertiesCache.delete(key);
    }
  }
}

/**
 * Get cached material properties or fetch from database if not cached
 */
async function getCachedMaterialProperties(
  carbon: SupabaseClient<Database>,
  substanceId: string
): Promise<MaterialPropertiesCache | null> {
  // Clean expired entries periodically
  if (materialPropertiesCache.size > 0) {
    cleanExpiredCache();
  }

  // Check if we have cached data for this substance
  const cached = materialPropertiesCache.get(substanceId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached;
  }

  // Fetch from database
  const [grades, dimensions, finishes, types, forms, substance] =
    await Promise.all([
      carbon
        .from("materialGrade")
        .select("id, name")
        .is("companyId", null)
        .eq("materialSubstanceId", substanceId),
      carbon
        .from("materialDimension")
        .select("id, name, materialFormId")
        .is("companyId", null)
        .or("materialFormId.eq.plate,materialFormId.eq.sheet"),
      carbon
        .from("materialFinish")
        .select("id, name")
        .is("companyId", null)
        .eq("materialSubstanceId", substanceId),
      carbon
        .from("materialType")
        .select("id, name, code")
        .is("companyId", null)
        .eq("materialSubstanceId", substanceId),
      carbon
        .from("materialForm")
        .select("id, name, code")
        .or("code.eq.plate,code.eq.sheet")
        .is("companyId", null),
      carbon
        .from("materialSubstance")
        .select("id, name, code")
        .eq("id", substanceId)
        .single()
    ]);

  // Check for any errors
  if (
    grades.error ||
    dimensions.error ||
    finishes.error ||
    types.error ||
    forms.error ||
    substance.error
  ) {
    console.error("Error fetching material properties:", {
      grades: grades.error,
      dimensions: dimensions.error,
      finishes: finishes.error,
      types: types.error,
      forms: forms.error,
      substance: substance.error
    });
    return null;
  }

  if (!substance.data) {
    console.error(`Substance not found for ID: ${substanceId}`);
    return null;
  }

  // Create cache entry
  const cacheEntry: MaterialPropertiesCache = {
    grades: grades.data || [],
    dimensions: dimensions.data || [],
    finishes: finishes.data || [],
    types: types.data || [],
    forms: forms.data || [],
    substance: substance.data,
    timestamp: Date.now()
  };

  // Cache the result
  materialPropertiesCache.set(substanceId, cacheEntry);

  return cacheEntry;
}

/**
 * Clear all cached material properties
 */
export function clearMaterialPropertiesCache(): void {
  materialPropertiesCache.clear();
  console.log("Material properties cache cleared");
}

/**
 * Get current cache statistics
 */
export function getMaterialPropertiesCacheStats(): {
  size: number;
  substances: string[];
  oldestEntry?: number;
  newestEntry?: number;
} {
  const substances = Array.from(materialPropertiesCache.keys());
  const timestamps = Array.from(materialPropertiesCache.values()).map(
    (v) => v.timestamp
  );

  return {
    size: materialPropertiesCache.size,
    substances,
    oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined
  };
}

export type MaterialNamingDetails = {
  // IDs for database operations
  gradeId?: string | null;
  dimensionId?: string | null;
  finishId?: string | null;
  formId?: string;
  typeId?: string | null;

  // Names for getMaterialDescription
  materialType?: string;
  substance?: string;
  grade?: string;
  shape?: string;
  dimensions?: string;
  finish?: string;

  // Codes for getMaterialId
  materialTypeCode?: string;
  substanceCode?: string;
  shapeCode?: string;

  // Other properties
  quantity?: number;
  confidence?: number;
  reasoningText?: string;
};

type PaperlessPartsMaterialInput = {
  description?: string;
  material?: {
    display_name?: string;
    family?: string;
    material_class?: string;
    name?: string;
  };
  material_operations?: {
    costing_variables?: QuoteCostingVariable[];
  }[];
  process?: {
    name?: string;
  };
  quantities?: {
    quantity?: number;
  }[];
};

async function determineMaterialProperties(
  carbon: SupabaseClient<Database>,
  substanceId: string,
  materialInfo: PaperlessPartsMaterialInput
): Promise<MaterialNamingDetails | null> {
  // Get cached or fresh material properties
  const materialProperties = await getCachedMaterialProperties(
    carbon,
    substanceId
  );

  if (!materialProperties) {
    return null;
  }

  const { grades, dimensions, finishes, types, forms, substance } =
    materialProperties;

  const { object } = await generateObject({
    model: openai(openAiCategorizationModel),
    schema: materialPropertiesSchema,
    prompt: `
    Based on the following material information, determine the best matching material properties from the available options.

    If the material is sheet metal, the quantity returned should be the parts per sheet. Use the materialFormId from the dimension to determine the formId to return.
    
    Material Information:
    - Description: ${materialInfo.description}
    - Material Name: ${materialInfo.material?.name}
    - Material Display Name: ${materialInfo.material?.display_name}
    - Material Family: ${materialInfo.material?.family}
    - Material Class: ${materialInfo.material?.material_class}
    - Process Name: ${materialInfo.process?.name}

    - Material Metadata:
    ${materialInfo.material_operations
      ?.map((op) =>
        op.costing_variables
          ?.map((cv) => `- ${cv.label}: ${cv.value}`)
          .join("\n")
      )
      .filter(Boolean)
      .join("\n")}
    
    Available Material Properties:
    - Grades: ${grades.map((g) => `${g.id}: ${g.name}`).join("\n")}
    - Dimensions: ${dimensions
      .map((d) => `${d.id}: ${d.name}, ${d.materialFormId}`)
      .join("\n")}
    - Finishes: ${finishes.map((f) => `${f.id}: ${f.name}`).join("\n")}
    - Types: ${types.map((t) => `${t.id}: ${t.name}`).join("\n")}
    
    Select the properties that best match the material information provided. Consider material type, grade, and common industry terminology.
    `,
    temperature: 0.2
  });

  if (object.confidence < 0.5) {
    return null;
  }

  const dimension = dimensions.find((d) => d.id === object.dimensionId);
  const form = forms.find((f) => f.id === dimension?.materialFormId);
  const grade = grades.find((g) => g.id === object.gradeId);
  const finish = finishes.find((f) => f.id === object.finishId);
  const type = types.find((t) => t.id === object.typeId);

  // Return enhanced structure with both IDs, names, and codes
  return {
    // IDs for database operations
    gradeId: object.gradeId,
    dimensionId: object.dimensionId,
    finishId: object.finishId,
    formId: dimension?.materialFormId,
    typeId: object.typeId,

    // Names for getMaterialDescription
    materialType: type?.name,
    substance: substance.name,
    grade: grade?.name,
    shape: form?.name,
    dimensions: dimension?.name,
    finish: finish?.name,

    // Codes for getMaterialId
    materialTypeCode: type?.code,
    substanceCode: substance.code,
    shapeCode: form?.code,

    // Other properties
    quantity: object.quantity,
    confidence: object.confidence,
    reasoningText: object.reasoningText
  };
}

/**
 * Get material properties with names and codes needed for getMaterialId and getMaterialDescription
 *
 * @example
 * ```typescript
 * const materialProps = await getMaterialProperties(client, materialId, companyId);
 * if (materialProps) {
 *   const newMaterialId = getMaterialId(materialProps);
 *   const newDescription = getMaterialDescription(materialProps);
 * }
 * ```
 *
 * @param carbon - Supabase client
 * @param materialId - The material ID (readableId)
 * @param companyId - The company ID
 * @returns Material naming details with both names and codes
 */
export async function getMaterialProperties(
  carbon: SupabaseClient<Database>,
  materialId: string,
  companyId: string
): Promise<MaterialNamingDetails | null> {
  try {
    const materialNamingDetails = await carbon
      .rpc("get_material_naming_details", { readable_id: materialId })
      .single();

    if (materialNamingDetails.error || !materialNamingDetails.data) {
      console.error(
        "Failed to get material naming details:",
        materialNamingDetails.error
      );
      return null;
    }

    const details = materialNamingDetails.data;

    return {
      // IDs for database operations (not available from this function)
      gradeId: null,
      dimensionId: null,
      finishId: null,
      formId: undefined,
      typeId: null,

      // Names for getMaterialDescription
      materialType: details.materialType,
      substance: details.substance,
      grade: details.grade,
      shape: details.shape,
      dimensions: details.dimensions,
      finish: details.finish,

      // Codes for getMaterialId
      materialTypeCode: details.materialTypeCode,
      substanceCode: details.substanceCode,
      shapeCode: details.shapeCode,

      // Other properties
      quantity: undefined,
      confidence: undefined,
      reasoningText: undefined
    };
  } catch (error) {
    console.error("Error getting material properties:", error);
    return null;
  }
}

export async function getOrCreateMaterial(
  carbon: SupabaseClient<Database>,
  args: {
    input: PaperlessPartsMaterialInput;
    createdBy: string;
    companyId: string;
    defaultMethodType: "Buy" | "Pick";
    defaultTrackingType: "Inventory" | "Non-Inventory" | "Batch";
  }
): Promise<{
  itemId: string;
  unitOfMeasureCode: string;
  quantity: number;
} | null> {
  if (
    args.input.process?.name?.toLowerCase().includes("laser") ||
    args.input.process?.name?.toLowerCase().includes("plasma") ||
    args.input.process?.name?.toLowerCase().includes("jet")
  ) {
    console.log("Found material with laser, plasma, or jet process");
    const materialInfo = {
      description: args.input.description || "",
      materialName: args.input.material?.name || "",
      materialDisplayName: args.input.material?.display_name || "",
      materialFamily: args.input.material?.family || "",
      materialClass: args.input.material?.material_class || "",
      processName: args.input.process?.name || ""
    };

    const substanceResult = await determineMaterialSubstance(
      carbon,
      materialInfo
    );

    if (!substanceResult) {
      return null;
    }

    const materialPropertiesResult = await determineMaterialProperties(
      carbon,
      substanceResult.substanceId,
      args.input
    );

    if (!materialPropertiesResult) {
      return null;
    }

    // Use quantity from material properties AI determination, fallback to input quantity
    const quantity = materialPropertiesResult.quantity
      ? 1 / materialPropertiesResult.quantity
      : args.input.quantities?.[0]?.quantity || 1;

    let materialQuery = carbon
      .from("material")
      .select("id")
      .eq("companyId", args.companyId);

    if (substanceResult.substanceId) {
      materialQuery = materialQuery.eq(
        "materialSubstanceId",
        substanceResult.substanceId
      );
    } else {
      materialQuery = materialQuery.is("materialSubstanceId", null);
    }

    if (materialPropertiesResult?.gradeId) {
      materialQuery = materialQuery.eq(
        "gradeId",
        materialPropertiesResult.gradeId
      );
    } else {
      materialQuery = materialQuery.is("gradeId", null);
    }

    if (materialPropertiesResult?.dimensionId) {
      materialQuery = materialQuery.eq(
        "dimensionId",
        materialPropertiesResult.dimensionId
      );
    } else {
      materialQuery = materialQuery.is("dimensionId", null);
    }

    if (materialPropertiesResult?.finishId) {
      materialQuery = materialQuery.eq(
        "finishId",
        materialPropertiesResult.finishId
      );
    } else {
      materialQuery = materialQuery.is("finishId", null);
    }

    if (materialPropertiesResult?.typeId) {
      materialQuery = materialQuery.eq(
        "materialTypeId",
        materialPropertiesResult.typeId
      );
    } else {
      materialQuery = materialQuery.is("materialTypeId", null);
    }

    const materialResult = await materialQuery.single();

    if (materialResult.data) {
      const item = await carbon
        .from("item")
        .select("id, revision, unitOfMeasureCode")
        .eq("companyId", args.companyId)
        .eq("readableId", materialResult.data.id);

      if (item.error || !item.data?.length) {
        console.error(`Failed to find item:`);

        return null;
      }

      return {
        itemId: item.data[0]?.id ?? "",
        unitOfMeasureCode: item.data[0]?.unitOfMeasureCode ?? "EA",
        quantity
      };
    } else {
      const readableId = getMaterialId({
        materialTypeCode: materialPropertiesResult?.materialTypeCode,
        substanceCode: materialPropertiesResult?.substanceCode,
        grade: materialPropertiesResult?.grade,
        shapeCode: materialPropertiesResult?.shapeCode,
        dimensions: materialPropertiesResult?.dimensions,
        finish: materialPropertiesResult?.finish
      });
      const description = getMaterialDescription({
        materialType: materialPropertiesResult?.materialType,
        substance: materialPropertiesResult?.substance,
        grade: materialPropertiesResult?.grade,
        shape: materialPropertiesResult?.shape,
        dimensions: materialPropertiesResult?.dimensions,
        finish: materialPropertiesResult?.finish
      });

      const itemInsert = await carbon
        .from("item")
        .insert({
          readableId,
          name: description,
          type: "Material",
          replenishmentSystem: "Buy",
          defaultMethodType: args.defaultMethodType,
          itemTrackingType: args.defaultTrackingType,
          unitOfMeasureCode: "EA",
          active: true,
          companyId: args.companyId,
          createdBy: args.createdBy
        })
        .select("id, unitOfMeasureCode")
        .single();

      if (itemInsert.error) {
        console.error(`Failed to insert item:`, itemInsert.error);
        return null;
      }

      const materialData = {
        id: readableId,
        companyId: args.companyId,
        materialSubstanceId: substanceResult.substanceId,
        materialFormId: materialPropertiesResult?.formId,
        gradeId: materialPropertiesResult?.gradeId,
        dimensionId: materialPropertiesResult?.dimensionId,
        finishId: materialPropertiesResult?.finishId,
        materialTypeId: materialPropertiesResult?.typeId,
        createdBy: args.createdBy
      };

      const materialInsert = await carbon
        .from("material")
        .upsert(materialData)
        .select("id")
        .single();

      if (materialInsert.error) {
        console.error(`Failed to insert material:`, materialInsert.error);
        return null;
      }

      return {
        itemId: itemInsert.data.id,
        unitOfMeasureCode: itemInsert.data.unitOfMeasureCode ?? "EA",
        quantity
      };
    }
  }

  return null;
}

/**
 * Upload CAD model file and create model record
 */
async function uploadModelFile(
  carbon: SupabaseClient<Database>,
  args: {
    file: File;
    companyId: string;
    itemId: string;
    salesOrderLineId: string;
    createdBy: string;
  }
): Promise<boolean> {
  const { file, companyId, itemId, salesOrderLineId, createdBy } = args;

  try {
    const modelId = nanoid();
    const fileExtension = file.name.split(".").pop();
    const modelPath = `${companyId}/models/${modelId}.${fileExtension}`;

    console.log(`Uploading CAD model ${file.name} to ${modelPath}`);

    // Upload model to storage
    const modelUpload = await carbon.storage
      .from("private")
      .upload(modelPath, file, {
        upsert: true
      });

    if (modelUpload.error) {
      console.error(`Failed to upload model ${file.name}:`, modelUpload.error);
      return false;
    }

    if (!modelUpload.data?.path) {
      console.error(`No path returned for uploaded model ${file.name}`);
      return false;
    }

    // Create model record
    const modelRecord = await carbon.from("modelUpload").insert({
      id: modelId,
      modelPath: modelUpload.data.path,
      name: file.name,
      size: file.size,
      companyId,
      createdBy
    });

    if (modelRecord.error) {
      console.error(
        `Failed to create model record for ${file.name}:`,
        modelRecord.error
      );
      return false;
    }

    // Link model to sales order line
    const [lineUpdate] = await Promise.all([
      carbon
        .from("salesOrderLine")
        .update({ modelUploadId: modelId })
        .eq("id", salesOrderLineId),
      carbon.from("item").update({ modelUploadId: modelId }).eq("id", itemId)
    ]);

    if (lineUpdate.error) {
      console.error(
        `Failed to link model to sales order line:`,
        lineUpdate.error
      );
      return false;
    }

    console.log(
      `Successfully uploaded CAD model ${file.name} and linked to line ${salesOrderLineId}`
    );
    return true;
  } catch (error) {
    console.error(`Error uploading model ${file.name}:`, error);
    return false;
  }
}

/**
 * Upload file to Carbon storage and create document record using upsertDocument
 */
async function uploadFileToItem(
  carbon: SupabaseClient<Database>,
  args: {
    file: File;
    companyId: string;
    itemId: string;
    createdBy: string;
  }
): Promise<boolean> {
  const { file, companyId, itemId } = args;

  if (file.name === "flat.step") return false;

  try {
    const storagePath = `${companyId}/parts/${itemId}/${stripSpecialCharacters(
      file.name
    )}`;

    console.log(`Uploading ${file.name} to ${storagePath}`);

    const fileUpload = await carbon.storage
      .from("private")
      .upload(storagePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true
      });

    if (fileUpload.error) {
      console.error(`Failed to upload file ${file.name}:`, fileUpload.error);
      return false;
    }

    if (!fileUpload.data?.path) {
      console.error(`No path returned for uploaded file ${file.name}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error uploading file ${file.name}:`, error);
    return false;
  }
}

/**
 * Download and upload supporting files for a component
 */
async function processSupportingFiles(
  carbon: SupabaseClient<Database>,
  args: {
    supportingFiles: Array<{ filename?: string; url?: string }>;
    companyId: string;
    lineId: string;
    itemId: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    createdBy: string;
  }
): Promise<void> {
  const { supportingFiles, companyId, lineId, itemId, createdBy } = args;

  if (!supportingFiles?.length) {
    return;
  }

  console.log(
    `Processing ${supportingFiles.length} supporting files for line ${lineId}`
  );

  let hasModel = false;

  for (const supportingFile of supportingFiles) {
    if (!supportingFile.url || !supportingFile.filename) {
      console.warn(
        "Skipping supporting file with missing URL or filename:",
        supportingFile
      );
      continue;
    }

    try {
      // Download the file
      const file = await downloadFileFromUrl(
        supportingFile.url,
        supportingFile.filename
      );

      if (!file) {
        console.error(
          `Failed to download supporting file: ${supportingFile.filename}`
        );
        continue;
      }

      // Check if this is a CAD model file
      if (isModelFile(file.name) && !hasModel) {
        console.log(`Processing ${file.name} as CAD model`);
        const uploadSuccess = await uploadModelFile(carbon, {
          file,
          companyId,
          itemId,
          salesOrderLineId: lineId,
          createdBy
        });

        if (!uploadSuccess) {
          console.error(
            `Failed to upload CAD model: ${supportingFile.filename}`
          );
        }
      } else {
        hasModel = true;
        console.log(`Processing ${file.name} as document`);
        // Upload as regular document
        const uploadSuccess = await uploadFileToItem(carbon, {
          file,
          companyId,
          itemId,
          createdBy
        });

        if (!uploadSuccess) {
          console.error(
            `Failed to upload supporting file: ${supportingFile.filename}`
          );
        }
      }
    } catch (error) {
      console.error(
        `Error processing supporting file ${supportingFile.filename}:`,
        error
      );
    }
  }
}

export async function getCustomerIdAndContactId(
  carbon: SupabaseClient<Database>,
  paperless: PaperlessPartsClient<unknown>,
  args: {
    company: Database["public"]["Tables"]["company"]["Row"];
    contact: z.infer<typeof ContactSchema>;
    createdBy?: string;
  }
) {
  let customerId: string;
  let customerContactId: string;

  const { company, contact, createdBy = "system" } = args;

  if (!contact) {
    throw new Error("Missing contact from Paperless Parts");
  }

  // If the Paperless Parts quote contact has an account, get the customer from Carbon
  // based on the Paperless Parts ID
  // If the customer does not exist, create a new customer in Carbon

  if (contact.account) {
    const paperlessPartsCustomerId = contact.account?.id;

    const existingCustomerId = await lookupEntityByPaperlessId(
      carbon,
      "customer",
      "paperlessPartsId",
      String(paperlessPartsCustomerId!),
      company.id
    );

    if (existingCustomerId) {
      customerId = existingCustomerId;
    } else {
      const customerName = contact.account?.name!;

      // Try to find existing customer by name
      const existingCustomerByName = await carbon
        .from("customer")
        .select("id")
        .eq("companyId", company.id)
        .eq("name", customerName)
        .maybeSingle();

      if (existingCustomerByName.data) {
        customerId = existingCustomerByName.data.id;

        // Create the mapping for the existing customer
        await createPaperlessMapping(
          carbon,
          "customer",
          customerId,
          "paperlessPartsId",
          String(contact.account.id),
          company.id
        );
      } else {
        const newCustomer = await carbon
          .from("customer")
          .upsert(
            {
              companyId: company.id,
              name: customerName,
              currencyCode: company.baseCurrencyCode,
              createdBy
            },
            {
              onConflict: "name, companyId"
            }
          )
          .select()
          .single();

        if (newCustomer.error || !newCustomer.data) {
          console.error(
            "Failed to create customer in Carbon",
            newCustomer.error
          );
          throw new Error("Failed to create customer in Carbon");
        }

        customerId = newCustomer.data.id;

        // Create the mapping for the new customer
        await createPaperlessMapping(
          carbon,
          "customer",
          customerId,
          "paperlessPartsId",
          String(contact.account.id),
          company.id
        );
      }
    }
  } else {
    // If the quote contact does not have an account, first search for existing accounts
    // in Paperless Parts by name before creating a new one
    const customerName = `${contact.first_name} ${contact.last_name}`.trim();

    // Search for existing accounts in Paperless Parts by name first
    const existingAccountsResponse = await paperless.accounts.listAccounts({
      search: customerName
    });

    let paperlessPartsAccountId: number = 0;
    let existingPaperlessAccount = null;

    if (
      existingAccountsResponse.data &&
      existingAccountsResponse.data.length > 0
    ) {
      // Look for an exact name match
      existingPaperlessAccount = existingAccountsResponse.data.find(
        (account) =>
          account.name?.trim().toLowerCase() === customerName.toLowerCase()
      );
    }

    if (existingPaperlessAccount) {
      // Use the existing account ID
      paperlessPartsAccountId = existingPaperlessAccount.id!;
    } else {
      // Create a new account in Paperless Parts
      let newPaperlessPartsAccount;
      try {
        newPaperlessPartsAccount = await paperless.accounts.createAccount({
          name: customerName
        });
      } catch (err) {
        // If an exception is thrown, try to read the error details
        if (err instanceof Response) {
          try {
            const errorBody = await err.text();
            console.log(`Error response body:`, errorBody);
          } catch (e) {
            console.log(`Could not read error body:`, e);
          }
        }
        // Set to an error state to trigger the fallback logic
        newPaperlessPartsAccount = { error: err, data: null };
      }

      if (newPaperlessPartsAccount.error) {
        // If we get an error creating the account (e.g., "An account with this name already exists"),
        // search again more thoroughly to find the existing account
        console.log(
          `Account creation failed in Paperless Parts, searching more thoroughly for: ${customerName}`
        );

        // If the error is a Response object, try to get the actual error message
        if (newPaperlessPartsAccount.error instanceof Response) {
          try {
            const errorBody = await newPaperlessPartsAccount.error.text();
            console.log(`Error response body:`, errorBody);
          } catch (e) {
            console.log(`Could not read error body:`, e);
          }
        }

        // Try multiple search strategies to find the account
        const searchStrategies = [
          customerName.split(" ")[0], // First name only
          customerName.split(" ").pop() || customerName, // Last name only
          customerName // Full name again (in case initial search had timing issues)
        ];

        for (const searchTerm of searchStrategies) {
          const searchResponse = await paperless.accounts.listAccounts({
            search: searchTerm
          });

          if (searchResponse.data && searchResponse.data.length > 0) {
            // Look for an exact or close match
            existingPaperlessAccount = searchResponse.data.find((account) => {
              const accountNameLower = account.name?.trim().toLowerCase() || "";
              const customerNameLower = customerName.toLowerCase();
              return (
                accountNameLower === customerNameLower ||
                accountNameLower.includes(customerNameLower) ||
                customerNameLower.includes(accountNameLower)
              );
            });

            if (existingPaperlessAccount) {
              break;
            }
          }
        }

        // If still not found after all searches, try listing ALL accounts (with pagination if needed)
        if (!existingPaperlessAccount) {
          const allAccountsResponse = await paperless.accounts.listAccounts({});

          if (allAccountsResponse.data && allAccountsResponse.data.length > 0) {
            // Look for exact name match
            existingPaperlessAccount = allAccountsResponse.data.find(
              (account) =>
                account.name?.trim().toLowerCase() ===
                customerName.toLowerCase()
            );
          }
        }

        if (existingPaperlessAccount) {
          paperlessPartsAccountId = existingPaperlessAccount.id!;
        }

        // If we still haven't found an account, log the error but continue without throwing
        if (!existingPaperlessAccount) {
          console.error(
            `Could not create or find account in Paperless Parts for: ${customerName}. Error:`,
            newPaperlessPartsAccount.error
          );
          // Use a fallback approach - we'll create the customer in Carbon without a Paperless Parts account ID
          paperlessPartsAccountId = 0; // Use 0 as a fallback to indicate no Paperless Parts account
        }
      } else if (!newPaperlessPartsAccount.data) {
        console.error(
          "Failed to create account in Paperless Parts - no data returned"
        );
        paperlessPartsAccountId = 0; // Use 0 as a fallback
      } else {
        paperlessPartsAccountId = newPaperlessPartsAccount.data.id!;
      }
    }

    // Check if customer already exists in Carbon with this paperless account ID (if we have one)
    let existingCustomerIdByPaperless: string | null = null;
    if (paperlessPartsAccountId > 0) {
      existingCustomerIdByPaperless = await lookupEntityByPaperlessId(
        carbon,
        "customer",
        "paperlessPartsId",
        String(paperlessPartsAccountId),
        company.id
      );
    }

    if (existingCustomerIdByPaperless) {
      customerId = existingCustomerIdByPaperless;
    } else {
      // Try to find existing customer by name in Carbon
      const existingCustomerByName = await carbon
        .from("customer")
        .select("id")
        .eq("companyId", company.id)
        .eq("name", customerName)
        .maybeSingle();

      if (existingCustomerByName.data) {
        customerId = existingCustomerByName.data.id;

        // Create the mapping if we have a valid Paperless Parts account ID
        if (paperlessPartsAccountId > 0) {
          await createPaperlessMapping(
            carbon,
            "customer",
            customerId,
            "paperlessPartsId",
            String(paperlessPartsAccountId),
            company.id
          );
        }
      } else {
        // Create a new customer in Carbon
        const customerData: any = {
          companyId: company.id,
          name: customerName,
          currencyCode: company.baseCurrencyCode,
          createdBy
        };

        const newCustomer = await carbon
          .from("customer")
          .upsert(customerData, {
            onConflict: "name, companyId"
          })
          .select()
          .single();

        if (newCustomer.error || !newCustomer.data) {
          console.error(
            "Failed to create customer in Carbon",
            newCustomer.error
          );
          throw new Error("Failed to create customer in Carbon");
        }

        customerId = newCustomer.data.id;

        // Create the mapping if we have a valid Paperless Parts account ID
        if (paperlessPartsAccountId > 0) {
          await createPaperlessMapping(
            carbon,
            "customer",
            customerId,
            "paperlessPartsId",
            String(paperlessPartsAccountId),
            company.id
          );
        }
      }
    }
  }

  // Get the contact ID from Carbon based on the Paperless Parts ID
  const paperlessPartsContactId = contact.id;

  // Look up the contact via the mapping table
  const existingContactId = await lookupEntityByPaperlessId(
    carbon,
    "contact",
    "paperlessPartsId",
    String(paperlessPartsContactId!),
    company.id
  );

  if (existingContactId) {
    // Find the customerContact for this contact
    const existingCustomerContact = await carbon
      .from("customerContact")
      .select("id")
      .eq("contactId", existingContactId)
      .maybeSingle();

    if (existingCustomerContact.data) {
      customerContactId = existingCustomerContact.data.id;
    }
  }

  if (!customerContactId) {
    // If there is no matching contact in Carbon, check if contact exists by email first
    const existingContactByEmail = await carbon
      .from("contact")
      .select("id")
      .eq("companyId", company.id)
      .eq("email", contact.email!)
      .eq("isCustomer", true)
      .maybeSingle();

    let contactId: string;

    if (existingContactByEmail.data) {
      // Update the existing contact
      const updatedContact = await carbon
        .from("contact")
        .update({
          firstName: contact.first_name!,
          lastName: contact.last_name!
        })
        .eq("id", existingContactByEmail.data.id)
        .select()
        .single();

      if (updatedContact.error || !updatedContact.data) {
        console.error("Failed to update contact in Carbon", updatedContact);
        return {
          customerContactId: null,
          customerId
        };
      }

      contactId = updatedContact.data.id;

      // Create the mapping for the existing contact
      await createPaperlessMapping(
        carbon,
        "contact",
        contactId,
        "paperlessPartsId",
        String(contact.id),
        company.id
      );
    } else {
      // Create a new contact in Carbon
      const newContact = await carbon
        .from("contact")
        .insert({
          companyId: company.id,
          firstName: contact.first_name!,
          lastName: contact.last_name!,
          email: contact.email!,
          isCustomer: true
        })
        .select()
        .single();

      if (newContact.error || !newContact.data) {
        console.error("Failed to create contact in Carbon", newContact);
        return {
          customerContactId: null,
          customerId
        };
      }

      contactId = newContact.data.id;

      // Create the mapping for the new contact
      await createPaperlessMapping(
        carbon,
        "contact",
        contactId,
        "paperlessPartsId",
        String(contact.id),
        company.id
      );
    }

    // Check if customerContact already exists for this customer and contact
    const existingCustomerContactLink = await carbon
      .from("customerContact")
      .select("id")
      .eq("customerId", customerId)
      .eq("contactId", contactId)
      .maybeSingle();

    if (existingCustomerContactLink.data) {
      customerContactId = existingCustomerContactLink.data.id;
    } else {
      const newCustomerContact = await carbon
        .from("customerContact")
        .insert({
          customerId,
          contactId
        })
        .select()
        .single();

      if (newCustomerContact.error || !newCustomerContact.data) {
        console.error("Failed to create customerContact", newCustomerContact);
        return {
          customerContactId: null,
          customerId
        };
      }

      customerContactId = newCustomerContact.data.id;
    }
  }

  return {
    customerId,
    customerContactId
  };
}

export async function getCustomerLocationIds(
  carbon: SupabaseClient<Database>,
  args: {
    customerId: string;
    company: Database["public"]["Tables"]["company"]["Row"];
    billingInfo?: z.infer<typeof AddressSchema>;
    shippingInfo?: z.infer<typeof AddressSchema>;
  }
) {
  let invoiceLocationId: string | null = null;
  let shipmentLocationId: string | null = null;

  const { customerId, company, billingInfo, shippingInfo } = args;

  // Handle billing info / invoice location
  if (billingInfo) {
    const paperlessPartsBillingId = billingInfo.id;

    const existingInvoiceLocationId = await lookupEntityByPaperlessId(
      carbon,
      "customerLocation",
      "paperlessPartsId",
      String(paperlessPartsBillingId!),
      company.id
    );

    if (existingInvoiceLocationId) {
      invoiceLocationId = existingInvoiceLocationId;
    } else {
      // Try to find existing address by addressLine1 and city
      const existingAddress = await carbon
        .from("address")
        .select("id")
        .eq("companyId", company.id)
        .ilike("addressLine1", billingInfo.address1!)
        .ilike("city", billingInfo.city!)
        .maybeSingle();

      let addressId: string | null = null;

      if (existingAddress.data) {
        // Check if there's already a customer location for this address and customer
        const existingCustomerLocation = await carbon
          .from("customerLocation")
          .select("id")
          .eq("customerId", customerId)
          .eq("addressId", existingAddress.data.id)
          .maybeSingle();

        if (existingCustomerLocation.data) {
          invoiceLocationId = existingCustomerLocation.data.id;
        } else {
          addressId = existingAddress.data.id;
        }
      }

      if (!invoiceLocationId) {
        if (!addressId) {
          let countryCode = billingInfo.country;

          if (countryCode && countryCode.length == 3) {
            const country = await carbon
              .from("country")
              .select("alpha2")
              .eq("alpha3", countryCode)
              .maybeSingle();

            if (country.data) {
              countryCode = country.data.alpha2;
            }
          }

          if (countryCode && countryCode.length > 3) {
            countryCode = countryCode.slice(0, 2);
          }

          // Create new address
          const newAddress = await carbon
            .from("address")
            .insert({
              companyId: company.id,
              addressLine1: billingInfo.address1!,
              addressLine2: billingInfo.address2 || null,
              city: billingInfo.city!,
              stateProvince: billingInfo.state!,
              postalCode: billingInfo.postal_code!,
              countryCode
            })
            .select()
            .single();

          if (newAddress.error || !newAddress.data) {
            console.error(
              "Failed to create billing address in Carbon",
              newAddress.error
            );
            throw new Error("Failed to create billing address in Carbon");
          }

          addressId = newAddress.data.id;
        }

        // Create customer location
        const newCustomerLocation = await carbon
          .from("customerLocation")
          .insert({
            name:
              billingInfo.city && billingInfo.state
                ? `${billingInfo.city}, ${billingInfo.state}`
                : billingInfo.city || billingInfo.state || "",
            customerId,
            addressId
          })
          .select()
          .single();

        if (newCustomerLocation.error || !newCustomerLocation.data) {
          throw new Error(
            "Failed to create customer billing location in Carbon"
          );
        }

        invoiceLocationId = newCustomerLocation.data.id;

        // Create the mapping for the new billing location
        await createPaperlessMapping(
          carbon,
          "customerLocation",
          invoiceLocationId,
          "paperlessPartsId",
          String(billingInfo.id),
          company.id
        );
      }
    }
  }

  // Handle shipping info / shipment location
  if (shippingInfo) {
    const paperlessPartsShippingId = shippingInfo.id;

    const existingShipmentLocationId = await lookupEntityByPaperlessId(
      carbon,
      "customerLocation",
      "paperlessPartsId",
      String(paperlessPartsShippingId!),
      company.id
    );

    if (existingShipmentLocationId) {
      shipmentLocationId = existingShipmentLocationId;
    } else {
      // Try to find existing address by addressLine1 and city
      const existingAddress = await carbon
        .from("address")
        .select("id")
        .eq("companyId", company.id)
        .ilike("addressLine1", shippingInfo.address1!)
        .ilike("city", shippingInfo.city!)
        .maybeSingle();

      let addressId: string | null = null;

      if (existingAddress.data) {
        // Check if there's already a customer location for this address and customer
        const existingCustomerLocation = await carbon
          .from("customerLocation")
          .select("id")
          .eq("customerId", customerId)
          .eq("addressId", existingAddress.data.id)
          .maybeSingle();

        if (existingCustomerLocation.data) {
          shipmentLocationId = existingCustomerLocation.data.id;
        } else {
          addressId = existingAddress.data.id;
        }
      }

      if (!shipmentLocationId) {
        if (!addressId) {
          let countryCode = shippingInfo.country;

          if (countryCode && countryCode.length == 3) {
            const country = await carbon
              .from("country")
              .select("alpha2")
              .eq("alpha3", countryCode)
              .maybeSingle();

            if (country.data) {
              countryCode = country.data.alpha2;
            }
          }

          if (countryCode && countryCode.length > 3) {
            countryCode = countryCode.slice(0, 2);
          }
          // Create new address
          const newAddress = await carbon
            .from("address")
            .insert({
              companyId: company.id,
              addressLine1: shippingInfo.address1!,
              addressLine2: shippingInfo.address2 || null,
              city: shippingInfo.city!,
              stateProvince: shippingInfo.state!,
              postalCode: shippingInfo.postal_code!,
              countryCode
            })
            .select()
            .single();

          if (newAddress.error || !newAddress.data) {
            console.error(
              "Failed to create shipping address in Carbon",
              newAddress.error
            );
            throw new Error("Failed to create shipping address in Carbon");
          }

          addressId = newAddress.data.id;
        }

        let name = shippingInfo.facility_name || shippingInfo.business_name;
        if (!name) {
          name = shippingInfo.city || shippingInfo.state || "";
        }
        // Create customer location
        const newCustomerLocation = await carbon
          .from("customerLocation")
          .insert({
            name,
            customerId,
            addressId
          })
          .select()
          .single();

        if (newCustomerLocation.error || !newCustomerLocation.data) {
          throw new Error(
            "Failed to create customer shipping location in Carbon"
          );
        }

        shipmentLocationId = newCustomerLocation.data.id;

        // Create the mapping for the new shipping location
        await createPaperlessMapping(
          carbon,
          "customerLocation",
          shipmentLocationId,
          "paperlessPartsId",
          String(shippingInfo.id),
          company.id
        );
      }
    }
  }

  return {
    invoiceLocationId,
    shipmentLocationId
  };
}

export async function getEmployeeAndSalesPersonId(
  carbon: SupabaseClient<Database>,
  args: {
    company: Database["public"]["Tables"]["company"]["Row"];
    estimator?: z.infer<typeof SalesPersonSchema>;
    salesPerson?: z.infer<typeof SalesPersonSchema>;
    createdBy?: string;
  }
) {
  const { company, estimator, salesPerson, createdBy = "system" } = args;

  const employees = await carbon
    .from("employees")
    .select("id, email")
    .or(`email.eq.${estimator?.email},email.eq.${salesPerson?.email}`)
    .eq("companyId", company.id);

  if (employees.error) {
    console.error("Failed to fetch employees", employees.error);
    return {
      salesPersonId: null,
      estimatorId: null,
      createdBy
    };
  }

  const salesPersonId = employees.data?.find(
    (employee) => employee.email === salesPerson?.email
  )?.id;
  const estimatorId = employees.data?.find(
    (employee) => employee.email === estimator?.email
  )?.id;

  return {
    salesPersonId,
    estimatorId,
    createdBy: estimatorId ?? createdBy
  };
}

export async function getOrderLocationId(
  carbon: SupabaseClient<Database>,
  args: {
    company: Database["public"]["Tables"]["company"]["Row"];
    sendFrom?: z.infer<typeof FacilitySchema>;
  }
): Promise<string | null> {
  const { company, sendFrom } = args;

  const locations = await carbon
    .from("location")
    .select("id, name")
    .eq("companyId", company.id)
    .order("createdAt", { ascending: true });

  if (sendFrom) {
    const location = locations.data?.find(
      (location) =>
        location.name?.toLowerCase() === sendFrom.name?.toLowerCase()
    );

    if (location) {
      return location.id;
    }
  }

  // Fallback to the first created location
  if (locations.data && locations.data.length > 0 && locations.data[0]?.id) {
    return locations.data[0].id;
  }

  return null;
}

export function getCarbonOrderStatus(
  status: z.infer<typeof OrderSchema>["status"]
): Database["public"]["Enums"]["salesOrderStatus"] {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "pending":
    case "on_hold":
      return "Needs Approval";
    case "in_process":
      return "Confirmed";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Draft";
  }
}

/**
 * Find existing part by Paperless Parts external ID
 */
export async function getPaperlessPart(
  carbon: SupabaseClient<Database>,
  args: {
    companyId: string;
    paperlessPartsId: string | number;
    paperlessPartNumber?: string;
    paperlessPartRevision?: string;
    paperlessPartName?: string;
  }
): Promise<{ itemId: string; partId: string; revision: string | null } | null> {
  const {
    companyId,
    paperlessPartsId,
    paperlessPartNumber,
    paperlessPartRevision,
    paperlessPartName
  } = args;

  const existingItemId = await lookupEntityByPaperlessId(
    carbon,
    "item",
    "paperlessPartsId",
    String(paperlessPartsId),
    companyId
  );

  if (existingItemId) {
    const existingItem = await carbon
      .from("item")
      .select("id, readableId, revision")
      .eq("id", existingItemId)
      .single();

    if (existingItem.data) {
      return {
        itemId: existingItem.data.id,
        partId: existingItem.data.readableId,
        revision: existingItem.data.revision
      };
    }
  }

  if (paperlessPartNumber && paperlessPartRevision && paperlessPartName) {
    const existingPart = await carbon
      .from("item")
      .select("id, readableId, revision, name")
      .eq("companyId", companyId)
      .eq("readableId", paperlessPartNumber)
      .eq("revision", paperlessPartRevision)
      .eq("name", paperlessPartName)
      .maybeSingle();

    if (existingPart.data) {
      return {
        itemId: existingPart.data.id,
        partId: existingPart.data.readableId,
        revision: existingPart.data.revision
      };
    }
  }

  return null;
}

/**
 * Download and process thumbnail from URL, upload to Carbon storage
 */
async function downloadAndUploadThumbnail(
  carbon: SupabaseClient<Database>,
  args: {
    thumbnailUrl: string;
    companyId: string;
    itemId: string;
  }
): Promise<string | null> {
  const { thumbnailUrl, companyId, itemId } = args;

  try {
    // Download the thumbnail from the URL
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      console.error(`Failed to download thumbnail: ${response.statusText}`);
      return null;
    }

    const imageBuffer = await response.arrayBuffer();
    const blob = new Blob([imageBuffer]);

    // Create FormData to send to image resizer
    const formData = new FormData();
    formData.append("file", blob);
    formData.append("contained", "true");

    // Process the image through the resizer
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      console.error("SUPABASE_URL environment variable not found");
      return null;
    }

    const resizerResponse = await fetch(
      `${supabaseUrl}/functions/v1/image-resizer`,
      {
        method: "POST",
        body: formData
      }
    );

    if (!resizerResponse.ok) {
      console.error(`Image resizer failed: ${resizerResponse.statusText}`);
      return null;
    }

    // Get content type from response to determine file extension
    const contentType =
      resizerResponse.headers.get("Content-Type") || "image/png";
    const isJpg = contentType.includes("image/jpeg");
    const fileExtension = isJpg ? "jpg" : "png";

    const processedImageBuffer = await resizerResponse.arrayBuffer();
    const processedBlob = new Blob([processedImageBuffer], {
      type: contentType
    });

    // Generate filename and create File object
    const fileName = `${nanoid()}.${fileExtension}`;
    const thumbnailFile = new File([processedBlob], fileName, {
      type: contentType
    });

    // Upload to private bucket
    const storagePath = `${companyId}/thumbnails/${itemId}/${fileName}`;
    const { data, error } = await carbon.storage
      .from("private")
      .upload(storagePath, thumbnailFile, {
        upsert: true
      });

    if (error) {
      console.error("Failed to upload thumbnail to storage:", error);
      return null;
    }

    return data?.path || null;
  } catch (error) {
    console.error("Error processing thumbnail:", error);
    return null;
  }
}

/**
 * Create new item and part from Paperless Parts component data
 */
export async function createPartFromComponent(
  carbon: SupabaseClient<Database>,
  args: {
    companyId: string;
    createdBy: string;
    component: NonNullable<
      z.infer<typeof OrderItemSchema>["components"]
    >[number];
    componentsIndex?: Map<
      number,
      NonNullable<z.infer<typeof OrderItemSchema>["components"]>[number]
    >;
    defaultMethodType: "Buy" | "Pick";
    defaultTrackingType: "Inventory" | "Non-Inventory" | "Batch";
    billOfProcessBlackList?: string[];
  }
): Promise<{ itemId: string; partId: string }> {
  const {
    companyId,
    createdBy,
    component,
    defaultMethodType,
    defaultTrackingType,
    billOfProcessBlackList = []
  } = args;

  const operations: Omit<
    Database["public"]["Tables"]["methodOperation"]["Insert"],
    "makeMethodId"
  >[] = [];
  const materials: Omit<
    Database["public"]["Tables"]["methodMaterial"]["Insert"],
    "makeMethodId"
  >[] = [];

  if (component.material_operations || component.material) {
    const material = await getOrCreateMaterial(carbon, {
      companyId,
      createdBy,
      input: {
        ...(component as any),
        description: component.description || component.part_name || ""
      },
      defaultMethodType,
      defaultTrackingType
    });

    if (material) {
      materials.push({
        itemId: material.itemId,
        itemType: "Material",
        quantity: material.quantity,
        methodType: defaultMethodType,
        companyId,
        createdBy,
        unitOfMeasureCode: "EA"
      });
    }
  }

  if (component.shop_operations) {
    for await (const [
      index,
      operation
    ] of component.shop_operations.entries()) {
      if (operation.category === "operation") {
        // Check if operation is blacklisted
        const operationName =
          operation.operation_definition_name ?? operation.name;
        if (billOfProcessBlackList.length > 0 && operationName) {
          const isBlacklisted = billOfProcessBlackList.some((blacklistedName) =>
            operationName.toLowerCase().includes(blacklistedName.toLowerCase())
          );
          if (isBlacklisted) {
            console.log(`Skipping blacklisted operation: ${operationName}`);
            continue;
          }
        }

        const process = await getOrCreateProcess(
          carbon,
          operation,
          companyId,
          createdBy
        );
        if (process) {
          operations.push({
            order: operation.position ?? index + 1,
            operationOrder: "After Previous",
            operationType:
              process.processType === "Inside" ? "Inside" : "Outside",
            description:
              operation.operation_definition_name ??
              operation.name ??
              `Operation ${operation.position ?? index + 1}`,
            processId: process.id,
            companyId,
            createdBy,
            setupTime: (operation.setup_time ?? 0) * 60,
            setupUnit: "Total Minutes",
            // laborTime: // TODO: we'd have to standardize on a costing variable to use for this
            machineTime: (operation.runtime ?? 0) * 60,
            machineUnit: "Minutes/Piece",
            workInstruction: operation.notes
              ? textToTiptap(operation.notes)
              : {}
          });
        }
      } else {
        console.error("operation.category is not operation", operation);
      }
      // if (operation.costing_variables) {
      //   operation.costing_variables.forEach((cv: any) => {
      //     console.log("shop costing_variable", cv);
      //   });
      // }
      // if (operation.quantities) {
      //   operation.quantities.forEach((q: any) => {
      //     console.log("shop quantity", q.quantity);
      //   });
      // }
    }
  }

  // If the component has child components (nested BOM), add them as method materials (itemType: "Part").
  // Recurse so children-of-children also get their own make methods and method materials.
  if (Array.isArray(component.children) && component.children.length > 0) {
    const index = args.componentsIndex;
    for await (const childRef of component.children as Array<{
      child_id?: number;
      quantity?: number;
    }>) {
      if (!childRef?.child_id || !index) continue;
      const childComponent = index.get(childRef.child_id);
      if (!childComponent) continue;

      try {
        const { itemId: childItemId } = await getOrCreatePart(carbon, {
          companyId,
          createdBy,
          component: childComponent as any,
          componentsIndex: index,
          defaultMethodType,
          defaultTrackingType,
          billOfProcessBlackList
        });

        const childIsPurchased =
          (childComponent as any)?.obtain_method === "purchased";
        const methodType = childIsPurchased ? "Buy" : "Make";

        let materialMakeMethodId: string | undefined;
        if (methodType === "Make") {
          const materialMakeMethod = await carbon
            .from("makeMethod")
            .select("id")
            .eq("itemId", childItemId)
            .single();
          materialMakeMethodId = materialMakeMethod.data?.id;
        }

        materials.push({
          itemId: childItemId,
          itemType: "Part",
          methodType: methodType ?? "Pick",
          materialMakeMethodId,
          quantity:
            childRef.quantity ?? (childComponent as any)?.innate_quantity ?? 1,
          companyId,
          createdBy,
          unitOfMeasureCode: "EA"
        });
      } catch (err) {
        console.error(
          "Failed to add child component as method material:",
          childRef,
          err
        );
      }
    }
  }

  // Determine purchasing vs make
  const isPurchased =
    (component as any).obtain_method === "purchased" ||
    (component as any).process?.name === "Purchased Components" ||
    (component as any).process?.external_name === "Purchased Components";

  // Generate a stable readable ID and user-friendly name
  const partId = String(
    component.part_number || component.part_name || `PP-${component.id}`
  ).trim();
  const revision =
    component.revision && /[a-zA-Z0-9]/.test(component.revision)
      ? component.revision
      : "0";
  const rawName =
    component.part_number ||
    (component.part_name
      ? component.part_name
          .replace(/:[^/\\]*$/g, "")
          .replace(/\.(step|stp|sldprt|iges|igs|dxf|dwg)$/i, "")
      : undefined) ||
    component.description ||
    `Part ${component.id}`;
  const name = stripSpecialCharacters(String(rawName).trim());

  // Check if part already exists by partId (readableId)
  const existingItem = await carbon
    .from("item")
    .select("id")
    .eq("companyId", companyId)
    .eq("readableId", partId)
    .eq("revision", revision)
    .maybeSingle();

  if (existingItem.data) {
    // Update itemCost for existing purchased components
    if (isPurchased && (component as any).purchased_component?.piece_price) {
      const unitCost = parseFloat(
        String((component as any).purchased_component.piece_price)
      );

      if (unitCost > 0) {
        console.log(
          `Updating itemCost for existing purchased component ${partId} with unitCost: ${unitCost}`
        );

        const itemCostUpdate = await carbon
          .from("itemCost")
          .update({
            unitCost
          })
          .eq("itemId", existingItem.data.id)
          .eq("companyId", companyId)
          .single();

        if (itemCostUpdate.error) {
          console.error(
            `Failed to update itemCost for existing ${partId}:`,
            itemCostUpdate.error
          );
          // Don't throw here, just log the error and continue
        } else {
          console.log(`Successfully updated itemCost for existing ${partId}`);
        }
      }
    }

    return {
      itemId: existingItem.data.id,
      partId: partId
    };
  }

  // Create the item first
  const itemInsert = await carbon
    .from("item")
    .insert({
      readableId: partId,
      revision,
      name,
      description: component.description,
      type: "Part",
      replenishmentSystem: isPurchased ? "Buy" : "Make",
      defaultMethodType: isPurchased ? "Buy" : "Make",
      itemTrackingType: "Non-Inventory",
      unitOfMeasureCode: "EA",
      active: true,
      companyId,
      createdBy
    })
    .select("id")
    .single();

  if (itemInsert.error) {
    console.error("Failed to create item:", itemInsert.error);
    throw new Error(`Failed to create item: ${itemInsert.error.message}`);
  }

  const itemId = itemInsert.data.id;

  // Create the mapping for the new item
  await createPaperlessMapping(
    carbon,
    "item",
    itemId,
    "paperlessPartsId",
    String(component.part_uuid),
    companyId
  );

  // Update itemCost for purchased components
  if (isPurchased && (component as any).purchased_component?.piece_price) {
    const unitCost = parseFloat(
      String((component as any).purchased_component.piece_price)
    );

    if (unitCost > 0) {
      console.log(
        `Updating itemCost for purchased component ${partId} with unitCost: ${unitCost}`
      );

      const itemCostUpdate = await carbon
        .from("itemCost")
        .update({
          unitCost
        })
        .eq("itemId", itemId)
        .eq("companyId", companyId)
        .select("itemId")
        .single();

      if (itemCostUpdate.error) {
        console.error(
          `Failed to update itemCost for ${partId}:`,
          itemCostUpdate.error
        );
        // Don't throw here, just log the error and continue
      } else {
        console.log(`Successfully updated itemCost for ${partId}`);
      }
    }
  }

  // Download and upload thumbnail if available
  let thumbnailPath: string | null = null;
  if (!component.export_controlled && component.thumbnail_url) {
    thumbnailPath = await downloadAndUploadThumbnail(carbon, {
      thumbnailUrl: component.thumbnail_url,
      companyId,
      itemId
    });

    // Update the item with the thumbnail path
    if (thumbnailPath) {
      const thumbnailUpdate = await carbon
        .from("item")
        .update({ thumbnailPath })
        .eq("id", itemId);

      if (thumbnailUpdate.error) {
        console.error(
          "Failed to update item with thumbnail path:",
          thumbnailUpdate.error
        );
        // Don't throw here, just log the error and continue
      }
    }
  }

  // Create the part record (always), and only fetch makeMethod for non-purchased items
  const partInsert = await carbon.from("part").upsert({
    id: partId,
    companyId,
    createdBy
  });

  // Create the mapping for the part
  await createPaperlessMapping(
    carbon,
    "part",
    partId,
    "paperlessPartsId",
    String(component.part_uuid),
    companyId
  );

  let makeMethod: { data?: { id: string } | null; error?: any } = {
    data: null
  };
  if (!isPurchased) {
    makeMethod = await carbon
      .from("makeMethod")
      .select("id")
      .eq("itemId", itemId)
      .single();
  }

  if (partInsert.error) {
    console.error("Failed to create part:", partInsert.error);
  }
  if (makeMethod.error) {
    console.error("Failed to create make method:", makeMethod.error);
  }

  const makeMethodId = makeMethod.data?.id;

  if (makeMethodId) {
    if (operations.length) {
      const operationInsert = await carbon.from("methodOperation").insert(
        operations.map((operation) => ({
          ...operation,
          makeMethodId
        }))
      );
      if (operationInsert.error) {
        console.error(
          "Failed to create method operations:",
          operationInsert.error
        );
      }
    }

    if (materials.length) {
      const materialInsert = await carbon.from("methodMaterial").insert(
        materials.map((material) => ({
          ...material,
          makeMethodId
        }))
      );
      if (materialInsert.error) {
        console.error(
          "Failed to create method materials:",
          materialInsert.error
        );
      }
    }
  }

  return { itemId, partId };
}

/**
 * Get or create part from Paperless Parts component
 */
export async function getOrCreatePart(
  carbon: SupabaseClient<Database>,
  args: {
    companyId: string;
    createdBy: string;
    component: {
      id?: number;
      part_number?: string;
      part_name?: string;
      part_uuid?: string;
      revision?: string;
      description?: string | null;
      thumbnail_url?: string;
      part_url?: string;
      material_operations?: any[];
      material?: {
        display_name?: string;
        family?: string;
        material_class?: string;
        name?: string;
      };
      process?: {
        name?: string;
      };
      quantities?: {
        quantity?: number;
      }[];
      shop_operations?: any[];
      children?: any[];
      obtain_method?: string;
      export_controlled?: boolean;
    };
    componentsIndex?: Map<
      number,
      NonNullable<z.infer<typeof OrderItemSchema>["components"]>[number]
    >;
    defaultMethodType: "Buy" | "Pick";
    defaultTrackingType: "Inventory" | "Non-Inventory" | "Batch";
    billOfProcessBlackList?: string[];
  }
): Promise<{ itemId: string; partId: string }> {
  const {
    companyId,
    component,
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    defaultMethodType,
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    defaultTrackingType,
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    billOfProcessBlackList = []
  } = args;

  if (!component.part_uuid) {
    throw new Error("Component part_uuid is required");
  }

  // First, try to find existing part by external ID
  const existingPart = await getPaperlessPart(carbon, {
    companyId,
    paperlessPartsId: component.part_uuid,
    paperlessPartNumber: component.part_number,
    paperlessPartRevision: component.revision,
    paperlessPartName: component.part_name
  });

  if (existingPart) {
    // Update itemCost for existing purchased components found by external ID
    const isPurchased =
      (component as any).obtain_method === "purchased" ||
      (component as any).process?.name === "Purchased Components" ||
      (component as any).process?.external_name === "Purchased Components";

    if (isPurchased && (component as any).purchased_component?.piece_price) {
      const unitCost = parseFloat(
        String((component as any).purchased_component.piece_price)
      );

      if (unitCost > 0) {
        console.log(
          `Updating itemCost for existing purchased component (external ID) ${existingPart.partId} with unitCost: ${unitCost}`
        );

        const itemCostUpdate = await carbon
          .from("itemCost")
          .update({
            unitCost
          })
          .eq("itemId", existingPart.itemId)
          .eq("companyId", companyId)
          .select("itemId")
          .single();

        if (itemCostUpdate.error) {
          console.error(
            `Failed to update itemCost for existing (external ID) ${existingPart.partId}:`,
            itemCostUpdate.error
          );
          // Don't throw here, just log the error and continue
        } else {
          console.log(
            `Successfully updated itemCost for existing (external ID) ${existingPart.partId}`
          );
        }
      }
    }

    return existingPart;
  }

  // If not found, create new part
  return createPartFromComponent(carbon, args);
}

let servicePrefix = "Service: ";

async function getOrCreateProcess(
  carbon: SupabaseClient<Database>,
  operation: any,
  companyId: string,
  createdBy: string
) {
  let operationName = operation.name;
  if (operation.name?.startsWith(servicePrefix)) {
    operationName = operation.name.substring(servicePrefix.length);
  }
  const process = await carbon
    .from("process")
    .select("id, processType")
    .eq("name", operationName)
    .eq("companyId", companyId)
    .single();
  if (process.data) {
    return process.data;
  }

  const processInsert = await carbon
    .from("process")
    .insert({
      name: operationName,
      processType: operation.is_outside_service === true ? "Outside" : "Inside",
      companyId,
      createdBy,
      defaultStandardFactor: "Minutes/Piece"
    })
    .select("id, processType")
    .single();

  if (processInsert.error) {
    console.error("Failed to create process:", processInsert.error);
    return null;
  }
  return processInsert.data ?? null;
}

/**
 * Insert sales order lines from Paperless Parts order items
 */
export async function insertOrderLines(
  carbon: SupabaseClient<Database>,
  args: {
    salesOrderId: string;
    opportunityId: string;
    locationId: string;
    companyId: string;
    createdBy: string;
    orderItems: z.infer<typeof OrderSchema>["order_items"];
    defaultMethodType: "Buy" | "Pick";
    defaultTrackingType: "Inventory" | "Non-Inventory" | "Batch";
    billOfProcessBlackList?: string[];
  }
): Promise<void> {
  const {
    salesOrderId,
    locationId,
    companyId,
    createdBy,
    orderItems,
    defaultMethodType,
    defaultTrackingType,
    billOfProcessBlackList = []
  } = args;

  if (!orderItems?.length) {
    return;
  }

  let maxPromisedDate: string | null = null;
  let insertedLinesCount = 0;
  const holidays = await carbon
    .from("holiday")
    .select("*")
    .eq("companyId", companyId)
    .gte("date", new Date().toISOString())
    .lte(
      "date",
      new Date(new Date().setDate(new Date().getDate() + 30)).toISOString()
    );

  for (const orderItem of orderItems) {
    if (!orderItem.components?.length) {
      // Handle order items without components as comment lines
      if (orderItem.description || orderItem.public_notes) {
        const commentLine: Database["public"]["Tables"]["salesOrderLine"]["Insert"] =
          {
            salesOrderId,
            salesOrderLineType: "Comment",
            description: orderItem.description || orderItem.public_notes || "",
            companyId,
            createdBy
          };

        const result = await carbon
          .from("salesOrderLine")
          .insert(commentLine)
          .select("id")
          .single();

        if (result.error) {
          console.error("Failed to insert comment line:", result.error);
          continue;
        }

        insertedLinesCount++;
      }
      continue;
    }

    // Build an index of all components by id for quick child lookup
    const componentsIndex = new Map<
      number,
      (typeof orderItem.components)[number]
    >();
    for (const c of orderItem.components) {
      if (typeof c.id === "number") componentsIndex.set(c.id, c);
    }

    // Only create a sales line for root components (is_root_component === true)
    // All child components should be added as methodMaterials to their parents during part creation.
    const rootComponents = orderItem.components.filter(
      (c: any) => c.is_root_component === true || !c.parent_ids?.length
    );

    // Process only root components for sales order lines
    for (const component of rootComponents) {
      try {
        const { itemId } = await getOrCreatePart(carbon, {
          companyId,
          createdBy,
          component: component as any,
          componentsIndex,
          defaultMethodType,
          defaultTrackingType,
          billOfProcessBlackList
        });

        const leadTime = orderItem.lead_days ?? 7;
        const updateLeadTime = await carbon
          .from("itemReplenishment")
          .update({
            leadTime
          })
          .eq("itemId", itemId);

        if (updateLeadTime.error) {
          console.error("Failed to update lead time:", updateLeadTime.error);
        }

        const promisedDate = calculatePromisedDate(
          leadTime,
          holidays.data ?? []
        );

        // Update max promised date if this one is later
        if (
          !maxPromisedDate ||
          (promisedDate && promisedDate > maxPromisedDate)
        ) {
          maxPromisedDate = promisedDate;
        }

        const saleQuantity =
          component.deliver_quantity || orderItem.quantity || 1;
        const unitPrice = orderItem.unit_price
          ? parseFloat(orderItem.unit_price)
          : 0;
        const addOnCost = orderItem.add_on_fees
          ? parseFloat(String(orderItem.add_on_fees))
          : 0;

        const salesOrderLine: Database["public"]["Tables"]["salesOrderLine"]["Insert"] =
          {
            salesOrderId,
            salesOrderLineType: "Part",
            itemId,
            locationId,
            unitOfMeasureCode: "EA",
            description: component.description || orderItem.description,
            saleQuantity,
            unitPrice,
            addOnCost,
            companyId,
            createdBy,
            quantitySent: component.deliver_quantity,
            promisedDate:
              (promisedDate ?? orderItem.ships_on)
                ? new Date(promisedDate ?? orderItem.ships_on!).toISOString()
                : null,
            internalNotes: orderItem.private_notes
              ? textToTiptap(orderItem.private_notes)
              : null,
            externalNotes: orderItem.public_notes
              ? textToTiptap(orderItem.public_notes)
              : null
          };

        // Insert the line first to get the line ID
        const lineResult = await carbon
          .from("salesOrderLine")
          .insert(salesOrderLine)
          .select("id")
          .single();

        if (lineResult.error) {
          console.error(
            `Failed to insert sales order line for component ${component.part_uuid}:`,
            lineResult.error
          );
          continue;
        }

        const lineId = lineResult.data.id;
        insertedLinesCount++;

        // Now process supporting files with the actual line ID
        if (!orderItem.export_controlled) {
          try {
            let supportingFiles = [
              {
                filename: orderItem.filename,
                url: component.part_url
              }
            ];

            if (component.supporting_files) {
              const validSupportingFiles = (
                component.supporting_files as unknown as Array<{
                  filename?: string;
                  url?: string;
                }>
              ).filter((file): file is { filename: string; url: string } =>
                Boolean(file.filename && file.url)
              );
              supportingFiles.push(...validSupportingFiles);
            }
            const supportingFilesArray = supportingFiles.filter(
              (file): file is { filename: string; url: string } =>
                Boolean(file.filename && file.url)
            );

            await processSupportingFiles(carbon, {
              supportingFiles: supportingFilesArray,
              companyId,
              itemId,
              lineId, // Use the actual line ID
              sourceDocumentType: "Sales Order",
              sourceDocumentId: salesOrderId,
              createdBy
            });
          } catch (error) {
            console.error(
              `Failed to process supporting files for component ${component.part_uuid}:`,
              error
            );
            // Continue processing instead of failing the entire order
          }
        }
      } catch (error) {
        console.error(
          `Failed to process component ${component.part_uuid}:`,
          error
        );
        // Continue with other components instead of failing the entire order
        continue;
      }
    }
  }

  if (maxPromisedDate) {
    await carbon
      .from("salesOrderShipment")
      .update({ receiptPromisedDate: maxPromisedDate })
      .eq("id", salesOrderId);
  }

  if (insertedLinesCount === 0) {
    console.warn("No valid order lines were inserted");
    return;
  }
}

/**
 * Insert quote lines from Paperless Parts quote items
 */
export async function insertQuoteLines(
  carbon: SupabaseClient<Database>,
  args: {
    quoteId: string;
    opportunityId: string | undefined;
    locationId: string | null;
    companyId: string;
    createdBy: string;
    quoteItems: QuoteItem[];
    defaultMethodType: "Buy" | "Pick";
    defaultTrackingType: "Inventory" | "Non-Inventory" | "Batch";
    billOfProcessBlackList?: string[];
  }
): Promise<void> {
  const {
    quoteId,
    locationId,
    companyId,
    createdBy,
    quoteItems,
    defaultMethodType,
    defaultTrackingType,
    billOfProcessBlackList = []
  } = args;

  if (!quoteItems?.length) {
    return;
  }

  // Fetch work centers for the company to calculate operation rates
  const workCentersResult = await carbon
    .from("workCenters")
    .select("*")
    .eq("companyId", companyId);

  const workCenters = workCentersResult.data;

  /**
   * Get labor and overhead rates for an operation based on its process.
   * If a specific workCenterId is provided, uses that work center's rates.
   * Otherwise, calculates blended (average) rates from all work centers
   * that have the process assigned to them.
   */
  function getOperationRates(
    processId: string,
    workCenterId: string | null = null
  ): { laborRate: number; overheadRate: number; machineRate: number } {
    if (!workCenters) {
      return { laborRate: 0, overheadRate: 0, machineRate: 0 };
    }

    // If a specific work center is provided, use its rates
    if (workCenterId) {
      const workCenter = workCenters.find(
        (wc) => wc.id === workCenterId && wc.active
      );
      if (workCenter) {
        return {
          laborRate: workCenter.laborRate ?? 0,
          overheadRate: workCenter.overheadRate ?? 0,
          machineRate: workCenter.machineRate ?? 0
        };
      }
    }

    // Find all active work centers that have this process assigned
    const relatedWorkCenters = workCenters.filter((wc) => {
      const processes = wc.processes ?? [];
      return wc.active && processes.some((p: string) => p === processId);
    });

    // Calculate blended (average) rates from related work centers
    if (relatedWorkCenters.length > 0) {
      const laborRate =
        relatedWorkCenters.reduce((acc, wc) => acc + (wc.laborRate ?? 0), 0) /
        relatedWorkCenters.length;

      const overheadRate =
        relatedWorkCenters.reduce(
          (acc, wc) => acc + (wc.overheadRate ?? 0),
          0
        ) / relatedWorkCenters.length;

      const machineRate =
        relatedWorkCenters.reduce((acc, wc) => acc + (wc.machineRate ?? 0), 0) /
        relatedWorkCenters.length;

      return { laborRate, overheadRate, machineRate };
    }

    return { laborRate: 0, overheadRate: 0, machineRate: 0 };
  }

  let insertedLinesCount = 0;

  for (const quoteItem of quoteItems) {
    // Skip manual quote items (no actual part)
    if (quoteItem.type === "manual") {
      continue;
    }

    if (!quoteItem.components?.length) {
      continue;
    }

    // Build an index of all components by id for quick child lookup
    const componentsIndex = new Map<number, QuoteComponent>();
    for (const c of quoteItem.components) {
      if (typeof c.id === "number") {
        componentsIndex.set(c.id, c);
      } else if (typeof c.id === "string") {
        componentsIndex.set(parseInt(c.id), c);
      }
    }

    // Only create a quote line for root components
    const rootComponents = quoteItem.components.filter(
      (c: any) => c.is_root_component === true || !c.parent_ids?.length
    );

    for (const component of rootComponents) {
      try {
        const { itemId } = await getOrCreatePart(carbon, {
          companyId,
          createdBy,
          component: component as any,
          componentsIndex: componentsIndex as any,
          defaultMethodType,
          defaultTrackingType,
          billOfProcessBlackList
        });

        // Extract quantities array from component
        const quantities =
          component.quantities?.map((q) => q.quantity ?? 1) ?? [];

        // Determine method type
        const isPurchased =
          (component as any).obtain_method === "purchased" ||
          component.type === "purchased" ||
          component.process?.name === "Purchased Components";
        const rootMethodType = isPurchased ? "Buy" : "Make";

        // Insert quote line
        const quoteLine: Database["public"]["Tables"]["quoteLine"]["Insert"] = {
          quoteId,
          itemId,
          description: component.description || component.part_name || "",
          methodType: rootMethodType as "Make" | "Buy",
          quantity: quantities.length > 0 ? quantities : null,
          unitOfMeasureCode: "EA",
          status: "Not Started",
          locationId,
          companyId,
          createdBy,
          internalNotes: quoteItem.private_notes
            ? textToTiptap(quoteItem.private_notes)
            : null,
          externalNotes: quoteItem.public_notes
            ? textToTiptap(quoteItem.public_notes)
            : null
        };

        const lineResult = await carbon
          .from("quoteLine")
          .insert(quoteLine)
          .select("id")
          .single();

        if (lineResult.error) {
          console.error(
            `Failed to insert quote line for component ${component.part_uuid}:`,
            lineResult.error
          );
          continue;
        }

        const quoteLineId = lineResult.data.id;
        insertedLinesCount++;

        // Insert quote line prices for each quantity break
        if (component.quantities?.length) {
          const quoteLinePrices: Database["public"]["Tables"]["quoteLinePrice"]["Insert"][] =
            component.quantities.map((qp) => ({
              quoteId,
              quoteLineId,
              quantity: qp.quantity ?? 1,
              unitPrice: qp.unit_price ?? 0,
              leadTime: qp.lead_time ?? 0,
              discountPercent: 0,
              createdBy
            }));

          const priceResult = await carbon
            .from("quoteLinePrice")
            .insert(quoteLinePrices);

          if (priceResult.error) {
            console.error(
              `Failed to insert quote line prices for component ${component.part_uuid}:`,
              priceResult.error
            );
          }
        }

        // For Make items, get the auto-created quoteMakeMethod and add materials/operations
        if (rootMethodType === "Make") {
          const makeMethodResult = await carbon
            .from("quoteMakeMethod")
            .select("id")
            .eq("quoteLineId", quoteLineId)
            .is("parentMaterialId", null)
            .single();

          const rootQuoteMakeMethodId = makeMethodResult.data?.id;

          if (rootQuoteMakeMethodId) {
            // Recursive function to traverse component tree and add operations/materials
            async function traverseComponent(
              comp: QuoteComponent,
              quoteMakeMethodId: string
            ) {
              let materialOrder = 1;

              // 1. Insert quote operations from shop_operations FIRST
              if (
                Array.isArray(comp.shop_operations) &&
                comp.shop_operations.length > 0
              ) {
                let operationOrder = 1;

                for (const operation of comp.shop_operations) {
                  if (operation.category !== "operation") continue;

                  const operationName =
                    operation.operation_definition_name ?? operation.name;

                  // Check blacklist
                  if (operationName && billOfProcessBlackList.length > 0) {
                    const isBlacklisted = billOfProcessBlackList.some((bl) =>
                      operationName.toLowerCase().includes(bl.toLowerCase())
                    );
                    if (isBlacklisted) continue;
                  }

                  // Get or create process
                  const process = await getOrCreateProcess(
                    carbon,
                    operation,
                    companyId,
                    createdBy
                  );
                  if (!process) continue;

                  // Get labor and overhead rates for this operation
                  const operationRates = getOperationRates(process.id);

                  const quoteOperation: Database["public"]["Tables"]["quoteOperation"]["Insert"] =
                    {
                      quoteId,
                      quoteLineId,
                      quoteMakeMethodId,
                      processId: process.id,
                      order: operation.position ?? operationOrder++,
                      operationType:
                        process.processType === "Inside" ? "Inside" : "Outside",
                      description:
                        operationName ?? `Operation ${operationOrder}`,
                      setupTime: (operation.setup_time ?? 0) * 60,
                      setupUnit: "Total Minutes",
                      laborTime: 0,
                      laborUnit: "Minutes/Piece",
                      machineTime: (operation.runtime ?? 0) * 60,
                      machineUnit: "Minutes/Piece",
                      laborRate: operationRates.laborRate,
                      overheadRate: operationRates.overheadRate,
                      machineRate: operationRates.machineRate,
                      workInstruction: operation.notes
                        ? textToTiptap(operation.notes)
                        : {},
                      companyId,
                      createdBy
                    };

                  const opResult = await carbon
                    .from("quoteOperation")
                    .insert(quoteOperation);

                  if (opResult.error) {
                    console.error(
                      `Failed to insert quote operation ${operationName}:`,
                      opResult.error
                    );
                  }
                }
              }

              // 2. Insert raw material from component.material (always Buy/Pick, no child quoteMakeMethod)
              if (comp.material?.display_name || comp.material?.name) {
                try {
                  const materialResult = await getOrCreateMaterial(carbon, {
                    input: comp as any,
                    createdBy,
                    companyId,
                    defaultMethodType,
                    defaultTrackingType
                  });

                  if (materialResult) {
                    const materialItemResult = await carbon
                      .from("item")
                      .select("readableId, name")
                      .eq("id", materialResult.itemId)
                      .single();

                    const quoteMaterial: Database["public"]["Tables"]["quoteMaterial"]["Insert"] =
                      {
                        quoteId,
                        quoteLineId,
                        quoteMakeMethodId,
                        itemId: materialResult.itemId,
                        itemType: "Material",
                        methodType: defaultMethodType,
                        description:
                          materialItemResult.data?.name ??
                          comp.material?.display_name ??
                          comp.material?.name ??
                          "",
                        quantity: materialResult.quantity,
                        unitCost: 0,
                        unitOfMeasureCode: materialResult.unitOfMeasureCode,
                        order: materialOrder++,
                        companyId,
                        createdBy
                      };

                    await carbon.from("quoteMaterial").insert(quoteMaterial);
                  }
                } catch (error) {
                  console.error(
                    `Failed to create quote material for component ${comp.part_uuid}:`,
                    error
                  );
                }
              }

              // 3. Process child components - separate into Make vs non-Make
              if (Array.isArray(comp.children) && comp.children.length > 0) {
                const madeChildren: {
                  childRef: ComponentChild;
                  childComponent: QuoteComponent;
                  childItemId: string;
                }[] = [];
                const pickedOrBoughtChildren: {
                  childRef: ComponentChild;
                  childComponent: QuoteComponent;
                  childItemId: string;
                }[] = [];

                // First pass: categorize children
                for (const childRef of comp.children) {
                  if (!childRef?.child_id) continue;
                  const childComponent = componentsIndex.get(childRef.child_id);
                  if (!childComponent) continue;

                  try {
                    const { itemId: childItemId } = await getOrCreatePart(
                      carbon,
                      {
                        companyId,
                        createdBy,
                        component: childComponent as any,
                        componentsIndex: componentsIndex as any,
                        defaultMethodType,
                        defaultTrackingType,
                        billOfProcessBlackList
                      }
                    );

                    const childMethodType =
                      (childComponent as any)?.obtain_method === "purchased" ||
                      (childComponent as any)?.type === "purchased"
                        ? "Buy"
                        : "Make";

                    if (childMethodType === "Make") {
                      madeChildren.push({
                        childRef,
                        childComponent,
                        childItemId
                      });
                    } else {
                      pickedOrBoughtChildren.push({
                        childRef,
                        childComponent,
                        childItemId
                      });
                    }
                  } catch (err) {
                    console.error(
                      "Failed to get or create part for child component:",
                      childRef,
                      err
                    );
                  }
                }

                // 4. Insert "Make" materials first - a trigger will create quoteMakeMethod for each
                if (madeChildren.length > 0) {
                  const madeMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
                    [];

                  for (const { childComponent, childItemId } of madeChildren) {
                    const childItemResult = await carbon
                      .from("item")
                      .select("readableId, name")
                      .eq("id", childItemId)
                      .single();

                    madeMaterialInserts.push({
                      quoteId,
                      quoteLineId,
                      quoteMakeMethodId,
                      itemId: childItemId,
                      itemType: "Part",
                      methodType: "Make",
                      description:
                        childItemResult.data?.name ??
                        (childComponent as any).description ??
                        "",
                      quantity:
                        madeChildren.find((c) => c.childItemId === childItemId)
                          ?.childRef.quantity ??
                        (childComponent as any)?.innate_quantity ??
                        1,
                      unitCost: 0,
                      unitOfMeasureCode: "EA",
                      order: materialOrder++,
                      companyId,
                      createdBy
                    });
                  }

                  const madeMaterialResult = await carbon
                    .from("quoteMaterial")
                    .insert(madeMaterialInserts)
                    .select("id");

                  if (madeMaterialResult.error) {
                    console.error(
                      "Failed to insert made materials:",
                      madeMaterialResult.error
                    );
                  } else if (madeMaterialResult.data) {
                    // Query for auto-created quoteMakeMethod records
                    const childQuoteMakeMethods = await carbon
                      .from("quoteMakeMethod")
                      .select("id, parentMaterialId")
                      .in(
                        "parentMaterialId",
                        madeMaterialResult.data.map((m) => m.id)
                      );

                    if (childQuoteMakeMethods.data) {
                      // Create mapping from parentMaterialId to quoteMakeMethodId
                      const materialIdToQuoteMakeMethodId: Record<
                        string,
                        string
                      > = {};
                      for (const qmm of childQuoteMakeMethods.data) {
                        if (qmm.parentMaterialId && qmm.id) {
                          materialIdToQuoteMakeMethodId[qmm.parentMaterialId] =
                            qmm.id;
                        }
                      }

                      // Recursively process each "Make" child
                      for (const [
                        index,
                        { childComponent }
                      ] of madeChildren.entries()) {
                        const materialId = madeMaterialResult.data[index]?.id;
                        const childQuoteMakeMethodId = materialId
                          ? materialIdToQuoteMakeMethodId[materialId]
                          : null;

                        if (childQuoteMakeMethodId) {
                          await traverseComponent(
                            childComponent,
                            childQuoteMakeMethodId
                          );
                        }
                      }
                    }
                  }
                }

                // 5. Insert non-Make (Buy/Pick) materials
                if (pickedOrBoughtChildren.length > 0) {
                  for (const {
                    childRef,
                    childComponent,
                    childItemId
                  } of pickedOrBoughtChildren) {
                    const childItemResult = await carbon
                      .from("item")
                      .select("readableId, name")
                      .eq("id", childItemId)
                      .single();

                    const childMaterial: Database["public"]["Tables"]["quoteMaterial"]["Insert"] =
                      {
                        quoteId,
                        quoteLineId,
                        quoteMakeMethodId,
                        itemId: childItemId,
                        itemType: "Part",
                        methodType: "Buy",
                        description:
                          childItemResult.data?.name ??
                          (childComponent as any).description ??
                          "",
                        quantity:
                          childRef.quantity ??
                          (childComponent as any)?.innate_quantity ??
                          1,
                        unitCost: 0,
                        unitOfMeasureCode: "EA",
                        order: materialOrder++,
                        companyId,
                        createdBy
                      };

                    await carbon.from("quoteMaterial").insert(childMaterial);
                  }
                }
              }
            }

            // Start traversing from the root component
            await traverseComponent(component, rootQuoteMakeMethodId);
          }
        }

        // Process supporting files (non-ITAR items)
        if (!quoteItem.export_controlled && !component.export_controlled) {
          try {
            let supportingFiles = [
              {
                filename: component.part_name ?? "",
                url: component.part_url
              }
            ];

            if (component.supporting_files) {
              const validSupportingFiles = (
                component.supporting_files as unknown as Array<{
                  filename?: string;
                  url?: string;
                }>
              ).filter((file): file is { filename: string; url: string } =>
                Boolean(file.filename && file.url)
              );
              supportingFiles.push(...validSupportingFiles);
            }

            await processSupportingFiles(carbon, {
              supportingFiles,
              companyId,
              itemId,
              lineId: quoteLineId,
              sourceDocumentType: "Quote",
              sourceDocumentId: quoteId,
              createdBy
            });
          } catch (error) {
            console.error(
              `Failed to process supporting files for component ${component.part_uuid}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `Failed to process component ${component.part_uuid}:`,
          error
        );
        continue;
      }
    }
  }

  if (insertedLinesCount === 0) {
    console.warn("No valid quote lines were inserted");
    return;
  }

  console.log(`✅ Successfully inserted ${insertedLinesCount} quote lines`);
}
