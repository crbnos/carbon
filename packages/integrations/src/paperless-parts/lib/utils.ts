import type { Database } from "@carbon/database";
import { supportedModelTypes, textToTiptap } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type z from "zod";
import type { PaperlessPartsClient } from "./client";
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
async function uploadFileToOpportunityLine(
  carbon: SupabaseClient<Database>,
  args: {
    file: File;
    companyId: string;
    lineId: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    createdBy: string;
  }
): Promise<boolean> {
  const {
    file,
    companyId,
    lineId,
    sourceDocumentType,
    sourceDocumentId,
    createdBy,
  } = args;

  try {
    // Create storage path similar to OpportunityLineDocuments
    const storagePath = `${companyId}/opportunity-line/${lineId}/${stripSpecialCharacters(
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

    if (createdBy === "system") {
      return true; // Skip document creation if we don't have a user id
    }
    const documentType = getDocumentTypeFromFilename(file.name);
    const documentData = {
      name: file.name,
      path: fileUpload.data.path,
      size: Math.round(file.size / 1024), // Convert to KB
      sourceDocument: sourceDocumentType as "Sales Order",
      sourceDocumentId,
      companyId,
      type: documentType,
      readGroups: [createdBy],
      writeGroups: [createdBy],
      createdBy,
      active: true,
    };

    console.log(`Document data for ${file.name}:`, {
      ...documentData,
      type: documentType,
    });

    const documentInsert = await carbon
      .from("document")
      .insert(documentData)
      .select("id")
      .single();

    if (documentInsert.error) {
      console.error(
        `Failed to create document record for ${file.name}:`,
        documentInsert.error
      );
      return false;
    }

    console.log(
      `Successfully uploaded and created document record for ${file.name}`
    );
    return true;
  } catch (error) {
    console.error(`Error uploading file ${file.name}:`, error);
    return false;
  }
}

/**
 * Simple document type detection from filename
 */
function getDocumentTypeFromFilename(
  filename: string
): Database["public"]["Enums"]["documentType"] {
  const extension = filename.toLowerCase().split(".").pop() || "";

  if (["pdf"].includes(extension)) return "PDF";
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg"].includes(extension))
    return "Image";
  if (["doc", "docx"].includes(extension)) return "Document";
  if (["xls", "xlsx"].includes(extension)) return "Spreadsheet";
  if (["ppt", "pptx"].includes(extension)) return "Presentation";
  if (["txt"].includes(extension)) return "Text";
  if (["zip", "rar", "7z"].includes(extension)) return "Archive";
  if (["mp4", "avi", "mov"].includes(extension)) return "Video";
  if (["mp3", "wav"].includes(extension)) return "Audio";
  if (["step", "stp", "iges", "igs", "dwg", "dxf"].includes(extension))
    return "Model";

  return "Other";
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
  const {
    supportingFiles,
    companyId,
    lineId,
    itemId,
    sourceDocumentType,
    sourceDocumentId,
    createdBy,
  } = args;

  if (!supportingFiles?.length) {
    return;
  }

  console.log(
    `Processing ${supportingFiles.length} supporting files for line ${lineId}`
  );

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
      if (isModelFile(file.name)) {
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
        console.log(`Processing ${file.name} as document`);
        // Upload as regular document
        const uploadSuccess = await uploadFileToOpportunityLine(carbon, {
          file,
          companyId,
          lineId,
          sourceDocumentType,
          sourceDocumentId,
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
          console.error(updatedCustomer.error);
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
          console.error(newCustomer.error);
          throw new Error("Failed to create customer in Carbon");
        }

        customerId = newCustomer.data.id;
      }
    }
  } else {
    // If the quote contact does not have an account, we need to create a new customer in Carbon
    // and also create a corresponding account in Paperless Parts
    const customerName = `${contact.first_name} ${contact.last_name}`;

    // Create a new account in Paperless Parts
    const newPaperlessPartsAccount = await paperless.accounts.createAccount({
      name: customerName,
    });

    if (newPaperlessPartsAccount.error || !newPaperlessPartsAccount.data) {
      throw new Error("Failed to create account in Paperless Parts");
    }

    const newPaperlessPartsAccountId = newPaperlessPartsAccount.data.id;

    const newCustomer = await carbon
      .from("customer")
      .insert({
        companyId: company.id,
        name: customerName,
        externalId: {
          paperlessPartsId: newPaperlessPartsAccountId,
        },
        currencyCode: company.baseCurrencyCode,
        createdBy: "system",
      })
      .select()
      .single();

    if (newCustomer.error || !newCustomer.data) {
      throw new Error("Failed to create customer in Carbon");
    }

    console.info("🔰 New Carbon customer created");

    customerId = newCustomer.data.id;
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
      .insert({
        companyId: company.id,
        firstName: contact.first_name!,
        lastName: contact.last_name!,
        email: contact.email!,
        externalId: {
          paperlessPartsId: contact.id,
        },
      })
      .select()
      .single();

    if (newContact.error || !newContact.data) {
      throw new Error("Failed to create contact in Carbon");
    }

    console.info("🔰 New Carbon contact created");

    const newCustomerContact = await carbon
      .from("customerContact")
      .insert({
        customerId,
        contactId: newContact.data.id,
      })
      .select()
      .single();

    if (newCustomerContact.error || !newCustomerContact.data) {
      throw new Error("Failed to create customer contact in Carbon");
    }

    console.info("🔰 Carbon customerContact created");

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
            console.error(newAddress.error);
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
            console.error(newAddress.error);
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
    console.error(employees.error);
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
  }
): Promise<{ itemId: string; partId: string }> {
  const { companyId, createdBy, component } = args;

  const operations: Omit<
    Database["public"]["Tables"]["methodOperation"]["Insert"],
    "makeMethodId"
  >[] = [];

  // // Log costing variables and quantities if they exist
  // if (component.material_operations) {
  //   component.material_operations.forEach((operation: any) => {
  //     console.log("material operation", operation);
  //     if (operation.costing_variables) {
  //       operation.costing_variables.forEach((cv: any) => {
  //         console.log("material costing_variable", cv.costing_variable);
  //       });
  //     }
  //     if (operation.quantities) {
  //       operation.quantities.forEach((q: any) => {
  //         console.log("material quantity", q.quantity);
  //       });
  //     }
  //   });
  // }

  if (component.shop_operations) {
    for await (const [
      index,
      operation,
    ] of component.shop_operations.entries()) {
      if (operation.category === "operation") {
        const processId = await getOrCreateProcess(
          carbon,
          operation,
          companyId,
          createdBy
        );
        if (processId) {
          operations.push({
            order: operation.position ?? index + 1,
            operationOrder: "After Previous",
            description: operation.operation_definition_name,
            processId: processId.id,
            companyId,
            createdBy,
            setupTime: operation.setup_time,
            setupUnit: "Total Minutes",
            laborTime: operation.runtime,
            laborUnit: "Minutes/Piece",
            workInstruction: operation.notes
              ? textToTiptap(operation.notes)
              : {},
          });
        }
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

  // Generate a readable ID for the part
  const partId =
    component.part_number || component.part_name || `PP-${component.id}`;
  const revision = component.revision || "0";
  const name =
    component.part_name || component.part_number || `Part ${component.id}`;

  // Create the item first
  const itemInsert = await carbon
    .from("item")
    .insert({
      readableId: partId,
      revision,
      name,
      description: component.description,
      type: "Part",
      replenishmentSystem: "Make",
      defaultMethodType: "Make",
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

  // Create the part record
  const [partInsert, makeMethod] = await Promise.all([
    carbon.from("part").upsert({
      id: partId,
      companyId,
      createdBy,
      externalId: {
        paperlessPartsId: component.part_uuid,
      },
    }),
    carbon.from("makeMethod").select("id").eq("itemId", itemId).single(),
  ]);

  if (partInsert.error) {
    console.error("Failed to create part:", partInsert.error);
  }
  if (makeMethod.error) {
    console.error("Failed to create make method:", makeMethod.error);
  }

  console.log({ makeMethod });
  const makeMethodId = makeMethod.data?.id;

  if (makeMethodId) {
    const result = await carbon.from("methodOperation").insert(
      operations.map((operation) => ({
        ...operation,
        makeMethodId,
      }))
    );
    console.log({ result });
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
    };
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
    return existingPart;
  }

  // If not found, create new part
  return createPartFromComponent(carbon, args);
}

async function getOrCreateProcess(
  carbon: SupabaseClient<Database>,
  operation: any,
  companyId: string,
  createdBy: string
) {
  const process = await carbon
    .from("process")
    .select("id, processType")
    .eq("name", operation.name)
    .eq("companyId", companyId)
    .single();
  if (process.data) {
    return process.data;
  }

  const processInsert = await carbon
    .from("process")
    .insert({
      name: operation.name,
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

    // Process each component in the order item
    for (const component of orderItem.components) {
      try {
        const { itemId } = await getOrCreatePart(carbon, {
          companyId,
          createdBy,
          component,
        });

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
