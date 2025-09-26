import { openai } from "@ai-sdk/openai";
import type { Database } from "@carbon/database";
import {
  getMaterialDescription,
  getMaterialId,
  openAiCategorizationModel,
  supportedModelTypes,
  textToTiptap,
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { PaperlessPartsClient, QuoteCostingVariable } from "./client";
import type {
  AddressSchema,
  ContactSchema,
  FacilitySchema,
  OrderSchema,
  SalesPersonSchema,
} from "./schemas";

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
  reasoning: z
    .string()
    .describe("Brief explanation of why this substance was chosen"),
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
      temperature: 0.2,
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
  reasoning: z
    .string()
    .describe("Brief explanation of why this material properties were chosen"),
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
        .single(),
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
      substance: substance.error,
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
    timestamp: Date.now(),
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
    newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
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
  reasoning?: string;
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
    temperature: 0.2,
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
    reasoning: object.reasoning,
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
      reasoning: undefined,
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
  }
): Promise<{
  itemId: string;
  unitOfMeasureCode: string;
  quantity: number;
}> | null {
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
      processName: args.input.process?.name || "",
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
        itemId: item.data[0].id,
        unitOfMeasureCode: item.data[0].unitOfMeasureCode ?? "EA",
        quantity,
      };
    } else {
      const readableId = getMaterialId({
        materialTypeCode: materialPropertiesResult?.materialTypeCode,
        substanceCode: materialPropertiesResult?.substanceCode,
        grade: materialPropertiesResult?.grade,
        shapeCode: materialPropertiesResult?.shapeCode,
        dimensions: materialPropertiesResult?.dimensions,
        finish: materialPropertiesResult?.finish,
      });
      const description = getMaterialDescription({
        materialType: materialPropertiesResult?.materialType,
        substance: materialPropertiesResult?.substance,
        grade: materialPropertiesResult?.grade,
        shape: materialPropertiesResult?.shape,
        dimensions: materialPropertiesResult?.dimensions,
        finish: materialPropertiesResult?.finish,
      });

      const itemInsert = await carbon
        .from("item")
        .insert({
          readableId,
          name: description,
          type: "Material",
          replenishmentSystem: "Buy",
          defaultMethodType: "Buy",
          itemTrackingType: "Inventory",
          unitOfMeasureCode: "EA",
          active: true,
          companyId: args.companyId,
          createdBy: args.createdBy,
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
        createdBy: args.createdBy,
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
        quantity,
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
        upsert: true,
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
      createdBy,
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
      carbon.from("item").update({ modelUploadId: modelId }).eq("id", itemId),
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
        upsert: true,
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
          createdBy,
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
          createdBy,
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

    const existingCustomer = await carbon
      .from("customer")
      .select("id")
      .eq("companyId", company.id)
      .eq("externalId->>paperlessPartsId", String(paperlessPartsCustomerId!))
      .maybeSingle();

    if (existingCustomer.data) {
      customerId = existingCustomer.data.id;
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
        // Update the existing customer with the external ID
        const updatedCustomer = await carbon
          .from("customer")
          .update({
            externalId: {
              paperlessPartsId: contact.account.id,
            },
          })
          .eq("id", existingCustomerByName.data.id)
          .select()
          .single();

        if (updatedCustomer.error || !updatedCustomer.data) {
          console.error(
            "Failed to update customer externalId in Carbon",
            updatedCustomer.error
          );
          throw new Error("Failed to update customer externalId in Carbon");
        }

        customerId = updatedCustomer.data.id;
      } else {
        const newCustomer = await carbon
          .from("customer")
          .upsert(
            {
              companyId: company.id,
              name: customerName,
              externalId: {
                paperlessPartsId: contact.account.id,
              },
              currencyCode: company.baseCurrencyCode,
              createdBy,
            },
            {
              onConflict: "name, companyId",
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
      }
    }
  } else {
    // If the quote contact does not have an account, first search for existing accounts
    // in Paperless Parts by name before creating a new one
    const customerName = `${contact.first_name} ${contact.last_name}`.trim();

    // Search for existing accounts in Paperless Parts by name
    const existingAccountsResponse = await paperless.accounts.listAccounts({
      search: customerName,
    });

    let paperlessPartsAccountId: number;
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
      console.log(`🔗 Found existing Paperless Parts account: ${customerName}`);
    } else {
      // Create a new account in Paperless Parts
      const newPaperlessPartsAccount = await paperless.accounts.createAccount({
        name: customerName,
      });

      if (newPaperlessPartsAccount.error || !newPaperlessPartsAccount.data) {
        throw new Error("Failed to create account in Paperless Parts");
      }

      paperlessPartsAccountId = newPaperlessPartsAccount.data.id;
      console.log("🔰 New Paperless Parts account created");
    }

    // Check if customer already exists in Carbon with this paperless account ID
    const existingCustomerByPaperlessId = await carbon
      .from("customer")
      .select("id")
      .eq("companyId", company.id)
      .eq("externalId->>paperlessPartsId", String(paperlessPartsAccountId))
      .maybeSingle();

    if (existingCustomerByPaperlessId.data) {
      customerId = existingCustomerByPaperlessId.data.id;
    } else {
      // Try to find existing customer by name in Carbon
      const existingCustomerByName = await carbon
        .from("customer")
        .select("id")
        .eq("companyId", company.id)
        .eq("name", customerName)
        .maybeSingle();

      if (existingCustomerByName.data) {
        // Update the existing customer with the external ID
        const updatedCustomer = await carbon
          .from("customer")
          .update({
            externalId: {
              paperlessPartsId: paperlessPartsAccountId,
            },
          })
          .eq("id", existingCustomerByName.data.id)
          .select()
          .single();

        if (updatedCustomer.error || !updatedCustomer.data) {
          console.error(
            "Failed to update customer externalId in Carbon",
            updatedCustomer.error
          );
          throw new Error("Failed to update customer externalId in Carbon");
        }

        customerId = updatedCustomer.data.id;
        console.log(
          "🔗 Updated existing Carbon customer with Paperless Parts ID"
        );
      } else {
        // Create a new customer in Carbon
        const newCustomer = await carbon
          .from("customer")
          .upsert(
            {
              companyId: company.id,
              name: customerName,
              externalId: {
                paperlessPartsId: paperlessPartsAccountId,
              },
              currencyCode: company.baseCurrencyCode,
              createdBy,
            },
            {
              onConflict: "name, companyId",
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

        console.log("🔰 New Carbon customer created");
        customerId = newCustomer.data.id;
      }
    }
  }

  // Get the contact ID from Carbon based on the Paperless Parts ID
  const paperlessPartsContactId = contact.id;
  const existingCustomerContact = await carbon
    .from("customerContact")
    .select(
      `
            id,
            contact!inner (
              id,
              companyId,
              externalId
            )
          `
    )
    .eq("contact.companyId", company.id)
    .eq(
      "contact.externalId->>paperlessPartsId",
      String(paperlessPartsContactId!)
    )
    .maybeSingle();

  if (existingCustomerContact.data) {
    customerContactId = existingCustomerContact.data.id;
  } else {
    // If there is no matching contact in Carbon, we need to create a new contact in Carbon
    const newContact = await carbon
      .from("contact")
      .upsert(
        {
          companyId: company.id,
          firstName: contact.first_name!,
          lastName: contact.last_name!,
          email: contact.email!,
          isCustomer: true,
          externalId: {
            paperlessPartsId: contact.id,
          },
        },
        {
          onConflict: "companyId, email, isCustomer",
        }
      )
      .select()
      .single();

    if (newContact.error || !newContact.data) {
      console.error("Failed to create contact in Carbon", newContact);
      return {
        customerContactId: null,
        customerId,
      };
    }

    console.log("🔰 New Carbon contact created");

    const newCustomerContact = await carbon
      .from("customerContact")
      .insert({
        customerId,
        contactId: newContact.data.id,
      })
      .select()
      .single();

    if (newCustomerContact.error || !newCustomerContact.data) {
      console.error("Failed to create customerContact", newCustomerContact);
      return {
        customerContactId: null,
        customerId,
      };
    }

    console.log("🔰 Carbon customerContact created");

    customerContactId = newCustomerContact.data.id;
  }

  return {
    customerId,
    customerContactId,
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

    const existingInvoiceLocation = await carbon
      .from("customerLocation")
      .select("id")
      .eq("customerId", customerId)
      .eq("externalId->>paperlessPartsId", String(paperlessPartsBillingId!))
      .maybeSingle();

    if (existingInvoiceLocation.data) {
      invoiceLocationId = existingInvoiceLocation.data.id;
    } else {
      // Try to find existing address by addressLine1 and city
      const existingAddress = await carbon
        .from("address")
        .select("id")
        .eq("companyId", company.id)
        .ilike("addressLine1", billingInfo.address1!)
        .ilike("city", billingInfo.city!)
        .maybeSingle();

      let addressId: string;

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

          if (countryCode.length == 3) {
            const country = await carbon
              .from("country")
              .select("alpha2")
              .eq("alpha3", countryCode)
              .maybeSingle();

            if (country.data) {
              countryCode = country.data.alpha2;
            }
          }

          if (countryCode.length > 3) {
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
              countryCode,
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
            addressId,
            externalId: {
              paperlessPartsId: billingInfo.id,
            },
          })
          .select()
          .single();

        if (newCustomerLocation.error || !newCustomerLocation.data) {
          throw new Error(
            "Failed to create customer billing location in Carbon"
          );
        }

        invoiceLocationId = newCustomerLocation.data.id;
      }
    }
  }

  // Handle shipping info / shipment location
  if (shippingInfo) {
    const paperlessPartsShippingId = shippingInfo.id;

    const existingShipmentLocation = await carbon
      .from("customerLocation")
      .select("id")
      .eq("customerId", customerId)
      .eq("externalId->>paperlessPartsId", String(paperlessPartsShippingId!))
      .maybeSingle();

    if (existingShipmentLocation.data) {
      shipmentLocationId = existingShipmentLocation.data.id;
    } else {
      // Try to find existing address by addressLine1 and city
      const existingAddress = await carbon
        .from("address")
        .select("id")
        .eq("companyId", company.id)
        .ilike("addressLine1", shippingInfo.address1!)
        .ilike("city", shippingInfo.city!)
        .maybeSingle();

      let addressId: string;

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

          if (countryCode.length == 3) {
            const country = await carbon
              .from("country")
              .select("alpha2")
              .eq("alpha3", countryCode)
              .maybeSingle();

            if (country.data) {
              countryCode = country.data.alpha2;
            }
          }

          if (countryCode.length > 3) {
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
              countryCode,
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

        // Create customer location
        const newCustomerLocation = await carbon
          .from("customerLocation")
          .insert({
            name: shippingInfo.facility_name || shippingInfo.business_name,
            customerId,
            addressId,
            externalId: {
              paperlessPartsId: shippingInfo.id,
            },
          })
          .select()
          .single();

        if (newCustomerLocation.error || !newCustomerLocation.data) {
          throw new Error(
            "Failed to create customer shipping location in Carbon"
          );
        }

        shipmentLocationId = newCustomerLocation.data.id;
      }
    }
  }

  return {
    invoiceLocationId,
    shipmentLocationId,
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
      createdBy,
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
    createdBy: estimatorId ?? createdBy,
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
    .eq("companyId", company.id);

  if (sendFrom) {
    const location = locations.data?.find(
      (location) => location.name.toLowerCase() === sendFrom.name.toLowerCase()
    );

    if (location) {
      return location.id;
    }
  }

  const hq = locations.data?.filter((location) =>
    location.name.toLowerCase().includes("headquarters")
  );

  if (hq?.length) {
    return hq[0].id;
  }

  return locations.data?.[0]?.id ?? null;
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
export async function findPartByExternalId(
  carbon: SupabaseClient<Database>,
  args: {
    companyId: string;
    paperlessPartsId: string | number;
  }
): Promise<{ itemId: string; partId: string; revision: string | null } | null> {
  const { companyId, paperlessPartsId } = args;

  const existingPart = await carbon
    .from("item")
    .select("id, readableId, revision")
    .eq("companyId", companyId)
    .eq("externalId->>paperlessPartsId", String(paperlessPartsId))
    .maybeSingle();

  if (existingPart.data) {
    return {
      itemId: existingPart.data.id,
      partId: existingPart.data.readableId,
      revision: existingPart.data.revision,
    };
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
        body: formData,
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
      type: contentType,
    });

    // Generate filename and create File object
    const fileName = `${nanoid()}.${fileExtension}`;
    const thumbnailFile = new File([processedBlob], fileName, {
      type: contentType,
    });

    // Upload to private bucket
    const storagePath = `${companyId}/thumbnails/${itemId}/${fileName}`;
    const { data, error } = await carbon.storage
      .from("private")
      .upload(storagePath, thumbnailFile, {
        upsert: true,
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
    component: z.infer<
      typeof OrderSchema
    >["order_items"][number]["components"][number];
    componentsIndex?: Map<
      number,
      z.infer<typeof OrderSchema>["order_items"][number]["components"][number]
    >;
  }
): Promise<{ itemId: string; partId: string }> {
  const { companyId, createdBy, component } = args;

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
      input: component,
    });

    if (material) {
      materials.push({
        itemId: material.itemId,
        itemType: "Material",
        quantity: material.quantity,
        methodType: "Pick",
        companyId,
        createdBy,
        unitOfMeasureCode: "EA",
      });
    }
  }

  if (component.shop_operations) {
    for await (const [
      index,
      operation,
    ] of component.shop_operations.entries()) {
      if (operation.category === "operation") {
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
              : {},
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
          unitOfMeasureCode: "EA",
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
            unitCost,
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
      partId: partId,
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
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA",
      active: true,
      companyId,
      createdBy,
      externalId: {
        paperlessPartsId: component.part_uuid,
      },
    })
    .select("id")
    .single();

  if (itemInsert.error) {
    console.error("Failed to create item:", itemInsert.error);
    throw new Error(`Failed to create item: ${itemInsert.error.message}`);
  }

  const itemId = itemInsert.data.id;

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
          unitCost,
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
      itemId,
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
    createdBy,
    externalId: {
      paperlessPartsId: component.part_uuid,
    },
  });
  let makeMethod: { data?: { id: string } | null; error?: any } = {
    data: null,
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
          makeMethodId,
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
          makeMethodId,
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
      z.infer<typeof OrderSchema>["order_items"][number]["components"][number]
    >;
  }
): Promise<{ itemId: string; partId: string }> {
  const { companyId, component } = args;

  if (!component.part_uuid) {
    throw new Error("Component part_uuid is required");
  }

  // First, try to find existing part by external ID
  const existingPart = await findPartByExternalId(carbon, {
    companyId,
    paperlessPartsId: component.part_uuid,
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
            unitCost,
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
      defaultStandardFactor: "Minutes/Piece",
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
  }
): Promise<void> {
  const { salesOrderId, locationId, companyId, createdBy, orderItems } = args;

  if (!orderItems?.length) {
    return;
  }

  let insertedLinesCount = 0;

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
            createdBy,
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
          component,
          componentsIndex,
        });

        // console.log("component", component);

        // Calculate quantities
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
            // TODO: use the order date and the lead time to calculate the promsied date
            /* 
            SL:  I was hoping that Carbon could take the date the order was pushed and calculate the ship date based on the lead time selected. So let's say the lead time is 3 business days. If I push it tomorrow 8/20 at 7 AM that would be a ship date of 8/22, but if the order comes in a 11 AM that would roll into the next business day and the ship date would be 8/25. It would be nice if it also accounted for days off automatically because we pushed orders the past couple weeks thru but didn't tack on the extra day since labor day is 9/1. 
            */
            promisedDate: orderItem.ships_on
              ? new Date(orderItem.ships_on).toISOString()
              : null,
            internalNotes: orderItem.private_notes
              ? textToTiptap(orderItem.private_notes)
              : null,
            externalNotes: orderItem.public_notes
              ? textToTiptap(orderItem.public_notes)
              : null,
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
                url: component.part_url,
              },
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
              lineId, // Use the actual line ID
              sourceDocumentType: "Sales Order",
              sourceDocumentId: salesOrderId,
              createdBy,
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

  if (insertedLinesCount === 0) {
    console.warn("No valid order lines were inserted");
    return;
  }

  console.log(`Successfully inserted ${insertedLinesCount} order lines`);
}
