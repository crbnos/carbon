import { getMountClient } from "./lib/client";

export async function mountHealthcheck(companyId: string) {
  return await getMountClient().healthcheck(companyId);
}
