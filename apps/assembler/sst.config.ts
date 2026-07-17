/// <reference path="./.sst/platform/config.d.ts" />

// Assembler service infrastructure (SST v3 / Pulumi). ONE shared deployment per
// environment (commercial + GovCloud/ITAR), NOT per-workspace — point the env at
// the target account/region and deploy on its own cadence.
//
// Two runtimes, ONE image (`carbon/assembler:${IMAGE_TAG}`, same default HTTP
// entrypoint):
//   A. Lambda (default, $0 idle) — the app runs via the Lambda Web Adapter baked
//      into the Dockerfile (AWS_LWA_PORT=8000). Jobs run inline (POST ?sync); the
//      time-budget gate keeps them under the 900s hard timeout.
//   B. ECS Fargate Spot service (overflow, DEFAULT-OFF) — the same image as a warm
//      HTTP backend behind an ALB; async submit->poll, no 15-min cap. Enabled only
//      when ASSEMBLER_ECS_ENABLED=true ("don't scale until someone complains").
//
// Spec: .ai/specs/2026-07-15-assembler-deployment.md
//
// ⚠️ UNVALIDATED SCAFFOLD — this has NOT been `sst deploy`-validated in-session
// (no AWS creds, no `.sst/platform` types generated). Before the first deploy a
// human MUST: (1) fill the decisions marked `DECISION:` below, (2) `sst deploy`
// to a throwaway stage and reconcile any SST v3 API drift (esp. Service `capacity`
// / Vpc `nat` / FunctionUrl shape), (3) verify the acceptance rows in the spec.

export default $config({
  app(input) {
    return {
      name: "carbon-assembler",
      home: "aws",
      // DECISION: commercial vs GovCloud account/region come from the deploy env.
      region: process.env.AWS_REGION,
      removal: input?.stage === "prod" ? "retain" : "remove",
    };
  },
  async run() {
    const account = process.env.AWS_ACCOUNT_ID;
    const region = process.env.AWS_REGION;
    const imageTag = process.env.IMAGE_TAG ?? "latest";
    // Same image for both runtimes (built once by .github/workflows/assembler.yml).
    const image = `${account}.dkr.ecr.${region}.amazonaws.com/carbon/assembler:${imageTag}`;

    // Shared runtime env (same knobs on Lambda and the ECS service).
    const environment: Record<string, string | undefined> = {
      // Bearer key checked in-app on every non-/health route.
      ASSEMBLER_SERVICE_API_KEY: process.env.ASSEMBLER_SERVICE_API_KEY,
      // SSRF allow-list (prod: set it; DEV_MODE stays unset => default-deny).
      ASSEMBLER_ALLOWED_URL_HOSTS: process.env.ASSEMBLER_ALLOWED_URL_HOSTS,
      // Result-cache / job store. Unset => in-process (fine for single-replica).
      ASSEMBLER_REDIS_URL: process.env.ASSEMBLER_REDIS_URL,
      ASSEMBLER_MAX_CONCURRENCY: process.env.ASSEMBLER_MAX_CONCURRENCY,
      // Lambda path only: keep the optimize ladder under the 900s wall (degrade to
      // the coarsest rung once spent). The ECS service leaves this unset (no cap).
      ASSEMBLER_OPTIMIZE_BUDGET_SECS:
        process.env.ASSEMBLER_OPTIMIZE_BUDGET_SECS ?? "720",
    };

    // ---------------------------------------------------------------------------
    // Runtime A — Lambda (default, $0 idle)
    // ---------------------------------------------------------------------------
    // SST v3's `sst.aws.Function` has no prebuilt-container-image support, so use
    // the raw provider (SST v3 is Pulumi-based; raw `aws.*` composes fine).
    const lambdaRole = new aws.iam.Role("AssemblerLambdaRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    });
    new aws.iam.RolePolicyAttachment("AssemblerLambdaLogs", {
      role: lambdaRole.name,
      // CloudWatch logs only — image pull is handled by the Lambda service + the
      // ECR repo policy; the function makes no other AWS calls (storage I/O is via
      // caller-provided signed URLs).
      policyArn:
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    });

    const fn = new aws.lambda.Function("Assembler", {
      packageType: "Image",
      imageUri: image,
      role: lambdaRole.arn,
      memorySize: 10240, // 10 GB — max; the assembler is memory-heavy on big meshes
      timeout: 900, // 900s hard cap (not raisable) — the time-budget gate keeps jobs under it
      ephemeralStorage: { size: 10240 }, // 10 GB /tmp for the source download + temp GLBs
      architectures: ["x86_64"],
      environment: { variables: environment as Record<string, string> },
    });

    const fnUrl = new aws.lambda.FunctionUrl("AssemblerUrl", {
      functionName: fn.name,
      // DECISION: in-app bearer (authorizationType NONE) vs AWS_IAM. NONE keeps the
      // caller simple (Inngest sends the bearer); IAM needs SigV4 signing on every
      // call. Defaulting to NONE + in-app bearer per the spec.
      authorizationType: "NONE",
    });

    // ---------------------------------------------------------------------------
    // Runtime B — ECS Fargate Spot service (overflow, DEFAULT-OFF)
    // ---------------------------------------------------------------------------
    // Only stood up when ASSEMBLER_ECS_ENABLED=true. Off => $0 standing; overflow
    // jobs degrade (the app router falls back to poster tier). On => >=1 warm Spot
    // task; Spot interruptions self-heal via the service scheduler.
    const ecsEnabled = process.env.ASSEMBLER_ECS_ENABLED === "true";
    let serviceUrl: string | undefined;
    if (ecsEnabled) {
      // Public-subnet VPC, NO NAT — the service only needs egress to storage over
      // the public internet (signed URLs), which a public subnet + IGW gives for
      // free. DECISION: reuse the ERP/MES VPC instead if same-account/same-region.
      const vpc = new sst.aws.Vpc("AssemblerVpc", {
        // DECISION: verify the SST v3 Vpc option to drop NAT (cost). As of v3 this
        // is `nat: "ec2" | "managed" | { ... }` — omitting NAT keeps only public
        // subnets. Confirm against the installed SST version at deploy.
      });
      const cluster = new sst.aws.Cluster("AssemblerCluster", { vpc });

      const service = cluster.addService("AssemblerService", {
        cpu: "4 vCPU",
        memory: "16 GB", // DECISION: the big-job tier; size to the largest expected model
        image,
        // DECISION: Fargate Spot capacity (50-70% off). Verify the SST v3 Service
        // option — `capacity: "spot"` at time of writing.
        capacity: "spot",
        scaling: {
          // Default-off is expressed by not deploying the service at all (the
          // `ecsEnabled` gate); when deployed, hold >=1 warm task.
          min: Number(process.env.ASSEMBLER_ECS_MIN ?? "1"),
          max: Number(process.env.ASSEMBLER_ECS_MAX ?? "4"),
          cpuUtilization: 70,
          memoryUtilization: 80,
        },
        loadBalancer: {
          domain: {
            // DECISION: hostname + ACM cert (e.g. assembler-svc.carbon.ms). Internal
            // vs public+bearer is a decision; public+bearer here to match the Lambda.
            name: process.env.ASSEMBLER_SERVICE_HOSTNAME ?? "assembler-svc.carbon.ms",
            dns: false,
            cert: process.env.ASSEMBLER_SERVICE_CERT_ARN,
          },
          health: { "8000/http": { path: "/health" } },
          ports: [
            { listen: "80/http", forward: "8000/http" },
            { listen: "443/https", forward: "8000/http" },
          ],
        },
        port: 8000,
        environment: environment as Record<string, string>,
        transform: {
          loadBalancer: { idleTimeout: 600 },
          target: (args: { healthCheck?: unknown }) => {
            args.healthCheck = {
              enabled: true,
              path: "/health",
              protocol: "HTTP",
            };
          },
        },
      });
      serviceUrl = service.url as unknown as string;
    }

    // Outputs — wire these into the consumers' env at the human deploy step:
    //   ASSEMBLER_SERVICE_URL      <- lambdaUrl  (default, sync)
    //   ASSEMBLER_ECS_SERVICE_URL  <- serviceUrl (overflow, when enabled)
    //   ASSEMBLER_SYNC_ENABLED=true (so the router uses the Lambda sync path)
    return {
      lambdaUrl: fnUrl.functionUrl,
      serviceUrl,
    };
  },
});
