import { json, type ActionFunctionArgs } from "@remix-run/node";
import {
  finalizeAutodeskUpload,
  getAutodeskSignedUrl,
  getAutodeskToken,
  translateFile,
  uploadToAutodesk,
} from "~/lib/autodesk/autodesk.server";
import { upsertModelUpload } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const fileId = formData.get("fileId") as string;
  const modelPath = formData.get("modelPath") as string;
  const itemId = (formData.get("itemId") ?? undefined) as string | undefined;

  // const rfqId = (formData.get("rfqId") ?? undefined) as string | undefined;
  // const quoteId = (formData.get("quoteId") ?? undefined) as string | undefined;

  const autodeskToken = await getAutodeskToken();
  if (autodeskToken.error) {
    throw new Error(
      "Failed to get Autodesk token: " + autodeskToken.error.message
    );
  }
  const token = autodeskToken.data?.token;
  const encodedFilename = modelPath.split("/").pop() as string;

  const [signedUrl, blob] = await Promise.all([
    getAutodeskSignedUrl(encodedFilename, token),
    client.storage.from("private").download(modelPath),
  ]);
  if (signedUrl.error) {
    throw new Error("Failed to get signed URL: " + signedUrl.error.message);
  }
  if (blob.error) {
    throw new Error("Failed to download blob: " + blob.error.message);
  }

  const file = new File([blob.data], encodedFilename);
  const { uploadKey, url } = signedUrl.data;

  const initialUpload = await uploadToAutodesk(url, file, uploadKey);
  if (initialUpload.error) {
    throw new Error("Failed to upload file: " + initialUpload.error.message);
  }

  const upload = await finalizeAutodeskUpload(
    encodedFilename,
    token,
    uploadKey
  );
  if (upload.error) {
    throw new Error("Failed to finalize upload: " + upload.error.message);
  }

  const { urn } = upload.data;
  const autodeskUrn = Buffer.from(urn).toString("base64");

  const translation = await translateFile(autodeskUrn, token);
  if (translation.error) {
    throw new Error("Failed to translate file: " + translation.error.message);
  }

  const modelRecord = await upsertModelUpload(client, {
    id: fileId,
    autodeskUrn,
    modelPath,
    itemId: itemId,
    // rfqId,
    // quoteId,
    companyId,
    createdBy: userId,
  });

  if (modelRecord.error) {
    throw new Error("Failed to record upload: " + modelRecord.error.message);
  }

  return json({
    urn: autodeskUrn,
  });
}
