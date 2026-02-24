import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const companyId = "N4Mk6kWM4ycK5Qj941axi4";
const apiKey = "crbn_JLN5eYtzfoIzdkncQo3uO";
const carbonApiUrl = "http://localhost:54321"; // https://api.carbon.ms
const carbonPublicKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const apiUrl = "http://localhost:3000/api/model/upload"; // https://app.carbon.ms/api/model/upload

const filePath = "~/Downloads/test.stl";

(async () => {
  const resolvedPath = filePath.replace("~", process.env.HOME!);
  const fileName = path.basename(resolvedPath);
  const fileExtension = path.extname(resolvedPath).slice(1);
  const fileBuffer = fs.readFileSync(resolvedPath);
  const fileSize = fs.statSync(resolvedPath).size;

  const modelId = crypto.randomUUID();
  const modelPath = `${companyId}/models/${modelId}.${fileExtension}`;

  // 1. Upload the file to Supabase storage
  const client = createClient(carbonApiUrl, carbonPublicKey, {
    global: {
      headers: {
        "carbon-key": apiKey,
      },
    },
  });

  const { error: uploadError } = await client.storage
    .from("private")
    .upload(modelPath, fileBuffer, {
      contentType: "application/octet-stream",
    });

  if (uploadError) {
    console.error("Storage upload failed:", uploadError);
    process.exit(1);
  }

  console.log("File uploaded to storage:", modelPath);

  // 2. POST the metadata to the API
  const formData = new FormData();
  formData.append("modelId", modelId);
  formData.append("name", fileName);
  formData.append("modelPath", modelPath);
  formData.append("size", String(fileSize));

  const response = await axios.post(
    "http://localhost:3000/api/model/upload",
    formData,
    {
      headers: {
        "carbon-key": apiKey,
      },
    }
  );

  console.log(response.data);
})();
