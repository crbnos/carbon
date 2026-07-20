/// <reference path="./.sst/platform/config.d.ts" />

// Assembler service infrastructure (SST v4 Ion / Pulumi-based). ONE shared deployment per
// environment (commercial + GovCloud/ITAR), NOT per-workspace — point the env at
// the target account/region and deploy on its own cadence.
//
// Two runtimes, ONE image (`carbon/assembler:${IMAGE_TAG}`, same default HTTP
// entrypoint):
//   A. Lambda (default, $0 idle) — the app runs via the Lambda Web Adapter baked
//      into the Dockerfile (PORT=8000). Create self-invokes an Event-type worker
//      invocation; the auto time-budget gate keeps jobs under the 900s hard cap.
//   B. ECS Fargate Spot service (overflow, DEFAULT-OFF) — the same image as a warm
//      HTTP backend behind an ALB; async submit->poll, no 15-min cap. Enabled only
//      when ASSEMBLER_ECS_ENABLED=true ("don't scale until someone complains").
//
// Spec: .ai/specs/2026-07-15-assembler-deployment.md
//
// The Lambda + APIGW half is deploy-validated on staging. The ECS half is
// typechecked against the generated platform types but has never been
// deployed (gated off by default); fill the `DECISION:` markers and validate
// on a throwaway stage before first enabling it.

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
      // Job/result store — REQUIRED; the assembler refuses to boot without it.
      REDIS_URL: process.env.REDIS_URL,
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
      // shared Redis job store. Requires REDIS_URL.
      // Default 3008 MB: the cap on accounts without a Service Quotas increase,
      // so a fresh deploy works out of the box. Lambda's platform max is 10240 —
      // raise via ASSEMBLER_LAMBDA_MEMORY_MB once the quota bump lands (CPU
      // scales with memory, so bigger = faster on heavy meshes).
      memorySize: Number(process.env.ASSEMBLER_LAMBDA_MEMORY_MB ?? "3008"),
      timeout: 900, // 900s hard cap (not raisable) — the time-budget gate keeps jobs under it
      // /tmp for the source download + temp GLBs — 10 GB is GA on all accounts
      // (no quota), so keep the max regardless of the memory tier.
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
        }),
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
    const integration = new aws.apigatewayv2.Integration(
      "AssemblerIntegration",
      {
        apiId: api.id,
        integrationType: "AWS_PROXY",
        integrationUri: fn.invokeArn,
        payloadFormatVersion: "2.0",
      },
    );
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

    // Custom domain — repo convention: the ACM cert (REGIONAL, same region as
    // the API) and the DNS record (Cloudflare, proxy OFF) are managed
    // out-of-band; point a CNAME at the `apiDomainTarget` output. Gated on the
    // cert: no ASSEMBLER_CERT_ARN => skipped (staging keeps the execute-api URL).
    const domainName = process.env.ASSEMBLER_DOMAIN ?? "assembler.carbon.ms";
    const certArn = process.env.ASSEMBLER_CERT_ARN;
    let apiDomainTarget: $util.Output<string> | undefined;
    if (certArn) {
      const domain = new aws.apigatewayv2.DomainName("AssemblerDomain", {
        domainName,
        domainNameConfiguration: {
          certificateArn: certArn,
          endpointType: "REGIONAL",
          securityPolicy: "TLS_1_2",
        },
      });
      new aws.apigatewayv2.ApiMapping("AssemblerDomainMapping", {
        apiId: api.id,
        domainName: domain.id,
        stage: "$default",
      });
      apiDomainTarget = domain.domainNameConfiguration.targetDomainName;
    }

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
      // No `nat` arg => no NAT gateway (verified against the platform types);
      // tasks get public IPs + IGW egress for the signed-URL storage I/O.
      const vpc = new sst.aws.Vpc("AssemblerVpc");
      const cluster = new sst.aws.Cluster("AssemblerCluster", { vpc });

      // cluster.addService is deprecated — Service takes the cluster directly.
      const service = new sst.aws.Service("AssemblerService", {
        cluster,
        // Must match the image platform, same as the Lambda architectures arg.
        architecture:
          process.env.ASSEMBLER_LAMBDA_ARCH === "arm64" ? "arm64" : "x86_64",
        cpu: "4 vCPU",
        memory: "16 GB", // DECISION: the big-job tier; size to the largest expected model
        image,
        // Fargate Spot: 50-70% off; interruptions self-heal via the scheduler.
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
            name:
              process.env.ASSEMBLER_SERVICE_HOSTNAME ??
              "assembler-svc.carbon.ms",
            dns: false,
            cert: process.env.ASSEMBLER_SERVICE_CERT_ARN,
          },
          health: { "8000/http": { path: "/health" } },
          ports: [
            { listen: "80/http", forward: "8000/http" },
            { listen: "443/https", forward: "8000/http" },
          ],
        },
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
    //   ASSEMBLER_SERVICE_URL <- https://<ASSEMBLER_DOMAIN> when set, else apiUrl
    //   apiDomainTarget       <- CNAME target for the out-of-band DNS record
    return {
      apiUrl: api.apiEndpoint,
      apiDomainTarget,
      serviceUrl,
    };
  },
});
