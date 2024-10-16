import type { Database } from "@carbon/database";

export interface Email {
  company: Company;
  recipient: {
    firstName?: string;
    lastName?: string;
    email: string;
  };
  sender: {
    firstName: string;
    lastName: string;
    email: string;
  };
  locale: string;
}

export interface PDF {
  title?: string;
  meta?: Meta;
  company: Company;
  locale: string;
}

export type Meta = {
  author?: string;
  keywords?: string;
  subject?: string;
};

export type Company = Database["public"]["Tables"]["company"]["Row"];
export type QuoteCustomerDetails =
  Database["public"]["Views"]["quoteCustomerDetails"]["Row"];
