import { $ } from "execa";

import { client } from "./client";
import type { Workspace } from "./deploy";

// Deploys the assembler stack (apps/assembler/sst.config.ts) per workspace:
// one Lambda + API Gateway (plus optional ECS overflow) in each workspace's
// AWS account. Gated on the `assembler` column ALONE — independent of `aws`
// (which means "deploy ERP/MES via SST/ECS", i.e. GovCloud/ITAR). The main
// carbon.ms cloud runs its apps on Vercel (aws unset) but still wants the
// assembler in AWS, so the assembler must not depend on the `aws` flag. A row
// opts in by setting `assembler = true` plus its own aws_account_id / aws_region
// / redis_url — without turning on `aws`.

async function deploy(): Promise<void> {
  console.log("✅ 🌱 Starting assembler deployment");

  const imageTag = process.env.IMAGE_TAG;
  if (!imageTag) {
    console.error("🔴 🍳 Missing IMAGE_TAG environment variable");
    process.exit(1);
  }
  console.log(`✅ 🏷️ Using image tag: ${imageTag}`);

  const stage = process.env.STAGE ?? "prod";

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("*");

  if (error) {
    console.error("🔴 🍳 Failed to fetch workspaces", error);
    process.exit(1);
  }

  let hasErrors = false;

  for await (const workspace of workspaces as Workspace[]) {
    const {
      id,
      assembler,
      aws_account_id,
      aws_region,
      assembler_api_key,
      cert_arn_assembler,
      assembler_domain,
      redis_url,
    } = workspace;

    if (!assembler) {
      continue;
    }

    if (!aws_account_id) {
      console.log(`🔴 🍳 Missing AWS account id for ${id}`);
      continue;
    }
    if (!aws_region) {
      console.log(`🔴 🍳 Missing AWS region for ${id}`);
      continue;
    }
    if (!assembler_api_key) {
      console.log(`🔴 🍳 Missing assembler API key for ${id}`);
      continue;
    }

    // Reuses the workspace app redis as the assembler job store — must be
    // reachable from Lambda over the public internet.
    if (!redis_url) {
      console.log(`🔴 🍳 Missing Redis URL for ${id}`);
      continue;
    }

    console.log(`✅ 🔑 Setting up assembler environment for ${id}`);

    const $$ = $({
      // @ts-ignore
      env: {
        AWS_ACCOUNT_ID: aws_account_id,
        AWS_REGION: aws_region,
        IMAGE_TAG: imageTag,
        ASSEMBLER_SERVICE_API_KEY: assembler_api_key,
        REDIS_URL: redis_url,
        // Optional — enables the custom domain when set (else the raw
        // execute-api URL; sst.config.ts defaults the host to assembler.carbon.ms).
        ASSEMBLER_CERT_ARN: cert_arn_assembler ?? undefined,
        ASSEMBLER_DOMAIN: assembler_domain ?? undefined,
      },
      // Run SST from the assembler app where its sst.config.ts is located
      cwd: "../apps/assembler",
      stdio: "inherit",
    });

    try {
      console.log(`🚀 🐓 Deploying assembler for ${id} with SST`);
      await $$`npx --yes sst@3.17.24 deploy --stage ${stage}`;
      console.log(`✅ 🍗 Successfully deployed assembler for ${id}`);
    } catch (error) {
      console.error(`🔴 🍳 Failed to deploy assembler for ${id}`, error);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error("🔴 Assembler deployment completed with errors");
    process.exit(1);
  }

  console.log("✅ All assembler deployments completed successfully");
}

deploy().catch((error) => {
  console.error("🔴 Unexpected error during assembler deployment", error);
  process.exit(1);
});
