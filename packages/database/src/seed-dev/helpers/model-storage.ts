import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { insertId } from "../sql.ts";
import type { Ctx } from "../types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SeedModelUploadResult {
  modelUploadId: string;
  glbPath: string;
  graphPath: string;
  planPath: string;
}

interface AssemblyGraph {
  componentCount: number;
}

/**
 * Seeds a 3D model asset into Supabase storage and creates the modelUpload record.
 */
export async function seedPumpAndMotorModel(
  ctx: Ctx
): Promise<SeedModelUploadResult> {
  const { client, companyId } = ctx;

  const assetsDir = path.resolve(__dirname, "../assets/models/pump-motor");
  const glbFile = path.join(assetsDir, "pump-motor-assembly.glb");
  const graphFile = path.join(assetsDir, "graph.json");
  const planFile = path.join(assetsDir, "plan.json");

  for (const file of [glbFile, graphFile, planFile]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Seed: missing pump model asset ${file}`);
    }
  }
  const glbBuffer = fs.readFileSync(glbFile);
  const graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as AssemblyGraph;
  const plan: object = JSON.parse(fs.readFileSync(planFile, "utf8"));

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to seed model assets"
    );
  }

  const modelUploadId = await insertId(ctx, "modelUpload", {
    name: "Industrial Pump & Motor Assembly",
    size: glbBuffer.length,
    modelPath: "",
    processingStatus: "Idle",
    glbPath: "",
    graphPath: "",
    componentCount: graph.componentCount,
    optimizedModelPath: "",
    optimizeStatus: "Success",
    optimizedSize: glbBuffer.length,
    originalSize: glbBuffer.length,
    originalPath: ""
  });

  // CadModel recovers modelUpload.id from the filename stem of modelPath
  // (`${company}/models/${id}.glb`). A nested `.../${id}/model.glb` 404s artifacts.
  const glbPath = `${companyId}/models/${modelUploadId}.glb`;
  const graphPath = `${companyId}/models/${modelUploadId}.graph.json`;
  const planPath = `${companyId}/models/${modelUploadId}.plan.json`;

  const graphBuffer = Buffer.from(JSON.stringify(graph, null, 2), "utf8");
  const planBuffer = Buffer.from(JSON.stringify(plan, null, 2), "utf8");

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const uploadErrors = [];
  const { error: glbError } = await supabase.storage
    .from("private")
    .upload(glbPath, glbBuffer, {
      contentType: "model/gltf-binary",
      upsert: true
    });
  if (glbError) uploadErrors.push(glbError);

  const { error: graphError } = await supabase.storage
    .from("private")
    .upload(graphPath, graphBuffer, {
      contentType: "application/json",
      upsert: true
    });
  if (graphError) uploadErrors.push(graphError);

  const { error: planError } = await supabase.storage
    .from("private")
    .upload(planPath, planBuffer, {
      contentType: "application/json",
      upsert: true
    });
  if (planError) uploadErrors.push(planError);

  if (uploadErrors.length > 0) {
    await client.query(
      `UPDATE "modelUpload"
       SET "processingStatus" = 'Failed'
       WHERE id = $1 AND "companyId" = $2`,
      [modelUploadId, companyId]
    );
    throw uploadErrors[0];
  }

  await client.query(
    `UPDATE "modelUpload"
     SET "processingStatus" = 'Success', "modelPath" = $1, "glbPath" = $1, "graphPath" = $2, "optimizedModelPath" = $1, "originalPath" = $1
     WHERE id = $3 AND "companyId" = $4`,
    [glbPath, graphPath, modelUploadId, companyId]
  );

  return {
    modelUploadId,
    glbPath,
    graphPath,
    planPath
  };
}
