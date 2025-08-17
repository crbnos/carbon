import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type z from "zod";
import type { PaperlessPartsClient } from "./client";
import type { ContactSchema } from "./schemas";

export async function getCarbonCustomerIdAndContactId(
  carbon: SupabaseClient<Database>,
  paperless: PaperlessPartsClient<unknown>,
  company: Database["public"]["Tables"]["company"]["Row"],
  contact: z.infer<typeof ContactSchema>
) {
  let customerId: string;
  let customerContactId: string;

  if (!contact) {
    throw new Error("Missing contact from Paperless Parts");
  }

  // If the Paperless Parts quote contact has an account, get the customer from Carbon
  // based on the Paperless Parts ID
  // If the customer does not exist, create a new customer in Carbon

  if (contact.account) {
    const paperlessPartsCustomerId = contact.account?.id;

    // @ts-expect-error - JSONB column
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
