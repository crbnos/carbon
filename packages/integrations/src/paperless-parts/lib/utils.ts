import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type z from "zod";
import type { PaperlessPartsClient } from "./client";
import type { AddressSchema, ContactSchema } from "./schemas";

export async function getCarbonCustomerIdAndContactId(
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
      .eq("externalId->paperlessPartsId", paperlessPartsCustomerId!)
      .maybeSingle();

    if (existingCustomer.data) {
      customerId = existingCustomer.data.id;
    } else {
      const customerName = contact.account?.name!;
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
    .eq("contact.externalId->paperlessPartsId", paperlessPartsContactId!)
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

export async function getCarbonLocationIds(
  carbon: SupabaseClient<Database>,
  paperless: PaperlessPartsClient<unknown>,
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
      .eq("externalId->paperlessPartsId", paperlessPartsBillingId!)
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
            name: billingInfo.facility_name || billingInfo.business_name,
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
      .eq("externalId->paperlessPartsId", paperlessPartsShippingId!)
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
