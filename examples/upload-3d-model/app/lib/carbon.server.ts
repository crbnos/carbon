import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import {
  CARBON_API_KEY,
  CARBON_API_URL,
  CARBON_APP_URL,
  CARBON_COMPANY_ID,
  CARBON_PUBLIC_KEY,
} from "~/config";

class CarbonClient {
  private readonly appUrl: string = CARBON_APP_URL;
  private readonly client: SupabaseClient;
  private readonly companyId: string = CARBON_COMPANY_ID;
  constructor() {
    this.client = createClient(CARBON_API_URL, CARBON_PUBLIC_KEY, {
      global: {
        headers: {
          "carbon-key": CARBON_API_KEY,
        },
      },
    });
  }

  private getPublicModelUrl(path: string) {
    return `${this.appUrl}/file/model/public/${path}`;
  }

  async uploadModel(
    file: File
  ): Promise<
    { data: ModelUpload; error: null } | { data: null; error: PostgrestError }
  > {
    const { nanoid } = await import("nanoid");

    const modelId = nanoid();
    const fileExtension = file.name.split(".").pop();
    const fileName = `${this.companyId}/models/${modelId}.${fileExtension}`;

    const [fileUpload, recordInsert] = await Promise.all([
      this.client.storage.from("private").upload(fileName, file),
      this.client.from("modelUpload").insert({
        id: modelId,
        modelPath: fileName,
        size: file.size,
        name: file.name,
        companyId: this.companyId,
        createdBy: "system",
      }),
    ]);

    if (fileUpload.error) {
      return {
        data: null,
        error: fileUpload.error as unknown as PostgrestError,
      };
    }

    if (recordInsert.error) {
      return recordInsert;
    }

    return {
      data: {
        id: modelId,
        name: file.name,
        extension: fileExtension!,
        url: this.getPublicModelUrl(fileName),
      },
      error: null,
    };
  }

  async uploadThumbnail(file: File, modelId: string) {
    const { nanoid } = await import("nanoid");

    const thumbnailId = nanoid();
    const thumbnailPath = `${this.companyId}/thumbnails/${thumbnailId}.png`;

    const thumbnailUpload = await this.client.storage
      .from("private")
      .upload(thumbnailPath, file, {
        upsert: true,
        contentType: "image/png",
      });

    if (thumbnailUpload.error) {
      return {
        data: null,
        error: thumbnailUpload.error as unknown as PostgrestError,
      };
    }

    const updateModel = await this.client
      .from("modelUpload")
      .update({ thumbnailPath })
      .eq("id", modelId);
    if (updateModel.error) {
      return updateModel;
    }

    return {
      data: {
        id: thumbnailId,
      },
      error: null,
    };
  }
}

const carbon = new CarbonClient();

export { carbon };

export type ModelUpload = {
  id: string;
  name: string;
  extension: string;
  url: string;
};
