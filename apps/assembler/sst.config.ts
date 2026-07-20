/// <reference path="./.sst/platform/config.d.ts" />

// Assembler service infrastructure (SST v4 Ion / Pulumi-based). ONE shared deployment per
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
      // Job/result store — REQUIRED; the assembler refuses to boot without it.
      ASSEMBLER_REDIS_URL: process.env.ASSEMBLER_REDIS_URL,
      ASSEMBLER_MAX_CONCURRENCY: process.env.ASSEMBLER_MAX_CONCURRENCY,
      // Optimize time budget + dispatch mode are AUTO-DETECTED in-service from
      // AWS_LAMBDA_FUNCTION_NAME (720s ladder budget on Lambda; self-invoke
      // dispatch) — no env needed here.
    };

    // ---------------------------------------------------------------------------
    // Runtime A — Lambda (default, $0 idle)
    // ---------------------------------------------------------------------------
    // SST's `sst.aws.Function` has no prebuilt-container-image support, so use the
    // raw provider (SST v4 Ion is Pulumi-based; raw `aws.*` composes fine).
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
      // Async job model on Lambda: create returns 202 and fires the compute as
      // an Event-type SELF-invocation (its own 900s window); polls read the
      // shared Redis job store. Requires ASSEMBLER_REDIS_URL.
      // Assembler is memory-heavy on big meshes → 10 GB (the max) in prod. New AWS
      // accounts cap Lambda memory at 3008 MB until a Service Quotas increase, so
      // this is overridable (set ASSEMBLER_LAMBDA_MEMORY_MB=3008 for staging before
      // the quota bump). CPU scales with memory, so lower memory = slower jobs.
      memorySize: Number(process.env.ASSEMBLER_LAMBDA_MEMORY_MB ?? "10240"),
      timeout: 900, // 900s hard cap (not raisable) — the time-budget gate keeps jobs under it
      // /tmp for the source download + temp GLBs. Default max is 10 GB, but keep it
      // in step with the memory tier on a fresh account (also overridable).
      ephemeralStorage: {
        size: Number(process.env.ASSEMBLER_LAMBDA_TMP_MB ?? "10240"),
      },
      // MUST match the built image's platform. arm64 (Graviton) is cheaper + builds
      // natively on Apple-Silicon dev machines; x86_64 matches the amd64 CI build.
      architectures: [process.env.ASSEMBLER_LAMBDA_ARCH ?? "x86_64"],
      environment: { variables: environment as Record<string, string> },
    });

    // The create handler invokes this same function (Event type) to run the job.
    new aws.iam.RolePolicy("AssemblerSelfInvoke", {
      role: lambdaRole.id,
      policy: fn.arn.apply((arn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Action: "lambda:InvokeFunction", Resource: arn },
          ],
        })
      ),
    });

    // Public front door: API Gateway HTTP API (not a Function URL — those can't
    // carry a custom domain and this org's guardrail denies their anonymous
    // invoke; APIGW's service-principal invoke is allowed, TLS is built in, and
    // a custom domain attaches later via aws.apigatewayv2.DomainName + ACM).
    // Every request is short (create -> 202, poll ?wait<=25s) so the 30s
    // integration cap never binds; the compute runs in the self-invoked worker.
    // Only /health and /v1/* are routed — the /events worker inlet is
    // unreachable from outside. In-app bearer stays the real auth gate.
    const api = new aws.apigatewayv2.Api("AssemblerApi", {
      protocolType: "HTTP",
    });
    const integration = new aws.apigatewayv2.Integration("AssemblerIntegration", {
      apiId: api.id,
      integrationType: "AWS_PROXY",
      integrationUri: fn.invokeArn,
      payloadFormatVersion: "2.0",
    });
    for (const [name, routeKey] of [
      ["AssemblerRouteHealth", "GET /health"],
      ["AssemblerRouteV1", "ANY /v1/{proxy+}"],
    ] as const) {
      new aws.apigatewayv2.Route(name, {
        apiId: api.id,
        routeKey,
        target: integration.id.apply((id) => `integrations/${id}`),
      });
    }
    new aws.apigatewayv2.Stage("AssemblerStage", {
      apiId: api.id,
      name: "$default",
      autoDeploy: true,
    });
    new aws.lambda.Permission("AssemblerApiInvoke", {
      function: fn.name,
      action: "lambda:InvokeFunction",
      principal: "apigateway.amazonaws.com",
      sourceArn: api.executionArn.apply((arn) => `${arn}/*/*`),
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
    //   ASSEMBLER_SERVICE_URL      <- apiUrl     (default; async submit->poll)
    //   ASSEMBLER_ECS_SERVICE_URL  <- serviceUrl (overflow, when enabled)
    return {
      apiUrl: api.apiEndpoint,
      serviceUrl,
    };
  },
});
