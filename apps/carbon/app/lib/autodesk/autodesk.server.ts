import { redis } from "@carbon/kv";
import axios from "axios";

import { z } from "zod";
import {
  AUTODESK_BUCKET_NAME,
  AUTODESK_CLIENT_ID,
  AUTODESK_CLIENT_SECRET,
} from "~/config/env";
import { getSupabaseServiceRole } from "../supabase";
import type { AutodeskTokenResponse } from "./types";

const SIGNED_URL_EXPIRATION = 15;

const autodeskAPI = {
  finalizeAutodeskUpload: {
    url: (bucketName: string, filename: string) =>
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketName}/objects/${filename}/signeds3upload?minutesExpiration=${SIGNED_URL_EXPIRATION}`,
    method: "POST",
  },
  getManifest: {
    url: (urn: string) =>
      `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urn}/manifest`,
    method: "GET",
  },
  getSignedUrl: {
    url: (bucketName: string, filename: string) =>
      `https://developer.api.autodesk.com/oss/v2/buckets/${bucketName}/objects/${filename}/signeds3upload?minutesExpiration=${SIGNED_URL_EXPIRATION}`,
    method: "GET",
  },
  getThumbnail: {
    url: (urn: string) =>
      `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urn}/thumbnail?width=400&height=400`,
    method: "GET",
  },
  getToken: {
    url: "https://developer.api.autodesk.com/authentication/v2/token",
    method: "POST",
  },
  getTranslationStatus: {
    url: (urn: string) =>
      `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urn}/manifest`,
    method: "GET",
  },
  translateFile: {
    url: "https://developer.api.autodesk.com/modelderivative/v2/designdata/job",
    method: "POST",
  },
};

export type AutodeskSignedUrl = {
  uploadKey: string;
  url: string;
};

export const signedUrlSchema = z.object({
  uploadKey: z.string(),
  urls: z.array(z.string()),
});

export async function finalizeAutodeskUpload(
  encodedFilename: string,
  token: string,
  uploadKey: string
) {
  const url = autodeskAPI.finalizeAutodeskUpload.url(
    AUTODESK_BUCKET_NAME,
    encodedFilename
  );
  const body = {
    ossbucketKey: AUTODESK_BUCKET_NAME,
    ossSourceFileObjectKey: encodedFilename,
    access: "full",
    uploadKey,
  };

  let response;

  try {
    response = await axios(url, {
      method: autodeskAPI.finalizeAutodeskUpload.method,
      data: body,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    const message = (err as Error).message || "Something went wrong";
    console.error(message, err);
    return {
      data: null,
      error: {
        message,
      },
    };
  }

  return {
    data: {
      urn: response?.data?.objectId as string,
    },
    error: null,
  };
}

export async function getAutodeskSignedUrl(
  encodedFilename: string,
  token: string
) {
  let result: AutodeskSignedUrl | null = null;

  const uploadUrl = autodeskAPI.getSignedUrl.url(
    AUTODESK_BUCKET_NAME,
    encodedFilename
  );

  let response;

  try {
    response = await fetch(uploadUrl, {
      method: autodeskAPI.getSignedUrl.method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    const message = (err as Error).message || "Something went wrong";
    console.error(message, err);
    return {
      data: null,
      error: {
        message,
      },
    };
  }

  const reponseJson = await response?.json();
  const parsed = signedUrlSchema.safeParse(reponseJson);

  if (parsed.success === false) {
    return {
      data: null,
      error: {
        message: `Invalid response format: ${JSON.stringify(parsed.error)}`,
      },
    };
  }

  result = {
    uploadKey: parsed.data.uploadKey,
    url: parsed.data.urls?.[0] ?? "",
  };

  return {
    data: result,
    error: null,
  };
}

export async function getAutodeskToken(refresh = false, scope?: string) {
  if (!refresh) {
    try {
      const [token, ttl] = await Promise.all([
        redis.get("autodesk_token"),
        redis.ttl("autodesk_token"),
      ]);
      if (token && ttl > 60) {
        return {
          data: {
            token: token as string,
            expiresAt: Date.now() + ttl * 1000,
          },
          error: null,
        };
      }
    } catch {}
  }

  const url = autodeskAPI.getToken.url;
  const basic = `Basic ${Buffer.from(
    `${AUTODESK_CLIENT_ID}:${AUTODESK_CLIENT_SECRET}`
  ).toString("base64")}`;

  const postBody = {
    grant_type: "client_credentials",
    scope: scope || "data:write data:read bucket:create bucket:delete",
  };
  let response;

  try {
    response = await fetch(url, {
      method: autodeskAPI.getToken.method,
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: basic,
      },
      body: new URLSearchParams(postBody),
    });
    const result = (await response.json()) as AutodeskTokenResponse;
    if (result?.access_token) {
      redis.set("autodesk_token", result.access_token);
      redis.expire("autodesk_token", result.expires_in - 60);

      return {
        data: {
          token: result.access_token,
          expiresAt: Date.now() + (result.expires_in - 60) * 1000,
        },
        error: null,
      };
    } else {
      return {
        data: null,
        error: {
          message: "Failed to get token",
        },
      };
    }
  } catch (err) {
    const message = (err as Error).message || "Something went wrong";
    console.error(message, err);
    return {
      data: null,
      error: {
        message,
      },
    };
  }
}

export async function getManifest(
  urn: string,
  token: string,
  companyId: string
) {
  // poll the manifest endpoint for 30s until we get a response with progress === "complete"

  let response;
  let progress = "inprogress";
  let tries = 0;
  let thumbnailPath = "";

  while (progress !== "complete" && tries < 100) {
    try {
      response = await fetch(autodeskAPI.getManifest.url(urn), {
        method: autodeskAPI.getManifest.method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      progress = data.progress;
      if (progress === "complete") {
        const thumbnail = await getThumbnail(urn, token, companyId);

        if (thumbnail.data) {
          thumbnailPath = thumbnail.data;
        } else {
          console.log("Failed to get thumbnail for model", { urn });
        }
      }
    } catch (err) {
      const message = (err as Error).message || "Something went wrong";
      console.error(message, err);
      return {
        data: null,
        error: {
          message,
        },
      };
    }

    tries++;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (tries > 100) {
    return {
      data: null,
      error: {
        message: "Timeout",
      },
    };
  }

  return {
    data: { urn, thumbnailPath },
    error: null,
  };
}

export async function getThumbnail(
  urn: string,
  token: string,
  companyId: string
) {
  const supabase = getSupabaseServiceRole();
  const url = autodeskAPI.getThumbnail.url(urn);

  let response;
  try {
    response = await fetch(url, {
      method: autodeskAPI.getThumbnail.method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok && response.status === 200) {
      // the response is a binary stream of the thumbnail
      // of type image/png
      // we convert it to an ArrayBuffer and then upload it
      // to supabase storage
      const data = await response.arrayBuffer();
      const fileName = `${companyId}/models/${urn}.png`;

      const fileUpload = await supabase.storage
        .from("private")
        .upload(fileName, data, {
          cacheControl: `${365 * 24 * 60 * 60}`,
          upsert: true,
        });

      if (fileUpload.error) {
        return {
          data: null,
          error: {
            message: "Failed to upload thumbnail",
          },
        };
      }

      return {
        data: fileName,
        error: null,
      };
    }

    return { data: null, error: { message: "Failed to fetch thumbnail" } };
  } catch (err) {
    const message = (err as Error).message || "Something went wrong.";

    return {
      data: null,
      error: {
        message,
      },
    };
  }
}

export async function getTranslationStatus(urn: string, token: string) {
  const url = autodeskAPI.getTranslationStatus.url(urn);

  let response;
  try {
    response = await fetch(url, {
      method: autodeskAPI.getTranslationStatus.method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    return data.status;
  } catch (err) {
    const message = (err as Error).message || "Something went wrong.";

    console.error(`[getTranslationStatus]`, message, err);
  }
}

export async function translateFile(urn: string, token: string) {
  const url = autodeskAPI.translateFile.url;

  const body = {
    input: {
      urn: urn,
    },
    output: {
      destination: {
        region: "us",
      },
      formats: [
        {
          type: "svf2",
          views: ["3d"],
        },
        {
          type: "thumbnail",
          advanced: {
            height: 400,
            width: 400,
          },
        },
      ],
    },
  };

  let response;
  try {
    response = await axios(url, {
      method: autodeskAPI.translateFile.method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: body,
    });
  } catch (err) {
    const message = (err as Error).message || "Something went wrong";
    console.error(message, err);
    return {
      data: null,
      error: {
        message,
      },
    };
  }

  const data = response?.data;
  return { data: { urn: data?.urn, token }, error: null };
}

export async function uploadToAutodesk(url: string, file: File, token: string) {
  let response;

  try {
    response = await axios(url, {
      method: "PUT",
      data: await file.arrayBuffer(),
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
  } catch (err) {
    const message = (err as Error).message || "Something went wrong";

    return {
      data: null,
      error: {
        message,
      },
    };
  }

  return {
    data: response?.data,
    error: null,
  };
}
