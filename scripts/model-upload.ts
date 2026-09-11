import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  createScriptClient,
  readLocalScriptConfig
} from "./lib/local-script-config";

const {
  CARBON_COMPANY_ID: companyId,
  CARBON_API_KEY: apiKey,
  SUPABASE_URL: carbonApiUrl,
  SUPABASE_ANON_KEY: carbonPublicKey,
  MODEL_UPLOAD_URL: apiUrl,
  MODEL_FILE_PATH: filePath
} = readLocalScriptConfig(
  [
    "CARBON_COMPANY_ID",
    "CARBON_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "MODEL_UPLOAD_URL",
    "MODEL_FILE_PATH"
  ],
  process.env
);

(async () => {
  const resolvedPath = filePath.startsWith("~/")
    ? path.join(homedir(), filePath.slice(2))
    : filePath;
  const fileName = path.basename(resolvedPath);
  const fileExtension = path.extname(resolvedPath).slice(1);
  const fileBuffer = fs.readFileSync(resolvedPath);
  const fileSize = fs.statSync(resolvedPath).size;

  const modelId = randomUUID();
  const modelPath = `${companyId}/models/${modelId}.${fileExtension}`;

  // 1. Upload the file to Supabase storage
  const client = createScriptClient(carbonApiUrl, carbonPublicKey, apiKey);

  const { error: uploadError } = await client.storage
    .from("private")
    .upload(modelPath, fileBuffer, {
      contentType: "application/octet-stream"
    });

  if (uploadError) {
    process.stderr.write("Storage upload failed.\n");
    process.exit(1);
  }

  process.stdout.write(`File uploaded to storage: ${modelPath}\n`);

  // 2. POST the metadata to the API
  const formData = new FormData();
  formData.append("modelId", modelId);
  formData.append("name", fileName);
  formData.append("modelPath", modelPath);
  formData.append("size", String(fileSize));

  const response = await fetch(apiUrl, {
    method: "POST",
    body: formData,
    headers: {
      "carbon-key": apiKey
    }
  });

  if (!response.ok) throw new Error("Model metadata request failed");
  process.stdout.write(`${await response.text()}\n`);
})().catch(() => {
  process.stderr.write("Model upload failed.\n");
  process.exitCode = 1;
});
