import { PaperlessPartsClient } from "./client";

export * from "./schemas";
export * from "./utils";

export async function getPaperlessParts(apiKey: string) {
  const client = new PaperlessPartsClient(apiKey);
  return client;
}
