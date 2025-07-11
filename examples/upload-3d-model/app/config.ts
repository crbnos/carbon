const CARBON_API_KEY = process.env.CARBON_API_KEY!;
const CARBON_API_URL = process.env.CARBON_API_URL!;
const CARBON_APP_URL = process.env.CARBON_APP_URL!;
const CARBON_COMPANY_ID = process.env.CARBON_COMPANY_ID!;
const CARBON_PUBLIC_KEY = process.env.CARBON_PUBLIC_KEY!;

if (!CARBON_API_KEY) {
  throw new Error("CARBON_API_KEY must be set");
}

if (!CARBON_API_URL) {
  throw new Error("CARBON_API_URL must be set");
}

if (!CARBON_APP_URL) {
  throw new Error("CARBON_APP_URL must be set");
}

if (!CARBON_COMPANY_ID) {
  throw new Error("CARBON_COMPANY_ID must be set");
}

if (!CARBON_PUBLIC_KEY) {
  throw new Error("CARBON_PUBLIC_KEY must be set");
}

export {
  CARBON_API_KEY,
  CARBON_API_URL,
  CARBON_APP_URL,
  CARBON_COMPANY_ID,
  CARBON_PUBLIC_KEY,
};
