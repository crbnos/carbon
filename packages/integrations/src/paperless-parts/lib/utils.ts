import type { Database } from "@carbon/database";
import { textToTiptap } from "@carbon/utils";
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

export async function getCustomerIdAndContactId(
  carbon: SupabaseClient<Database>,
  paperless: PaperlessPartsClient<unknown>,
  args: {
    company: Database["public"]["Tables"]["company"]["Row"];
    contact: z.infer<typeof ContactSchema>;
  }
) {
  let customerId: string;
  let customerContactId: string;

  const { company, contact } = args;

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
              createdBy: "system",
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
  }
) {
  const { company, estimator, salesPerson } = args;

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
      createdBy: "system",
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
    createdBy: estimatorId ?? "system",
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
  const { companyId, createdBy, component } = args;

  console.log(component);

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
  if (component.thumbnail_url) {
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
  const partInsert = await carbon.from("part").upsert({
    id: partId,
    companyId,
    createdBy,
    externalId: {
      paperlessPartsId: component.part_uuid,
    },
  });

  if (partInsert.error) {
    console.error("Failed to create part:", partInsert.error);
    throw new Error(`Failed to create part: ${partInsert.error.message}`);
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

/**
 * Insert sales order lines from Paperless Parts order items
 */
export async function insertOrderLines(
  carbon: SupabaseClient<Database>,
  args: {
    salesOrderId: string;
    companyId: string;
    createdBy: string;
    orderItems: z.infer<typeof OrderSchema>["order_items"];
  }
): Promise<void> {
  const { salesOrderId, companyId, createdBy, orderItems } = args;

  if (!orderItems?.length) {
    return;
  }

  const linesToInsert: Database["public"]["Tables"]["salesOrderLine"]["Insert"][] =
    [];

  for (const orderItem of orderItems) {
    if (!orderItem.components?.length) {
      // Handle order items without components as comment lines
      if (orderItem.description || orderItem.public_notes) {
        linesToInsert.push({
          salesOrderId,
          salesOrderLineType: "Comment",
          description: orderItem.description || orderItem.public_notes || "",
          companyId,
          createdBy,
        });
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
            description: component.description || orderItem.description,
            saleQuantity,
            unitPrice,
            addOnCost,
            companyId,
            createdBy,
            quantitySent: component.deliver_quantity,
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

        linesToInsert.push(salesOrderLine);
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

  if (linesToInsert.length === 0) {
    console.warn("No valid order lines to insert");
    return;
  }

  // Insert all lines in a single operation
  const result = await carbon.from("salesOrderLine").insert(linesToInsert);

  if (result.error) {
    console.error("Failed to insert order lines:", result.error);
    throw new Error(`Failed to insert order lines: ${result.error.message}`);
  }

  console.log(`Successfully inserted ${linesToInsert.length} order lines`);
}
