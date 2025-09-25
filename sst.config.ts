/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "carbon",
      home: "aws",
      region: process.env.AWS_REGION,
      removal: input?.stage === "prod" ? "retain" : "remove",
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("CarbonVpc2");
    const cluster = new sst.aws.Cluster("CarbonCluster", {
      vpc,
      forceUpgrade: "v2",
    });
    const erp = cluster.addService("CarbonERPService", {
      image: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.us-gov-east-1.amazonaws.com/carbon/erp:latest`,
      loadBalancer: {
        domain: {
          name: "itar.carbon.ms",
          dns: false,
          cert: process.env.CERT_ARN_ERP,
        },
        rules: [
          { listen: "80/http", redirect: "443/https" },
          { listen: "443/https", forward: "3000/http" },
        ],
      },
      environment: {
        AUTODESK_BUCKET_NAME: process.env.AUTODESK_BUCKET_NAME,
        AUTODESK_CLIENT_ID: process.env.AUTODESK_CLIENT_ID,
        AUTODESK_CLIENT_SECRET: process.env.AUTODESK_CLIENT_SECRET,
        CARBON_EDITION: process.env.CARBON_EDITION,
        CLOUDFLARE_TURNSTILE_SECRET_KEY:
          process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
        CLOUDFLARE_TURNSTILE_SITE_KEY:
          process.env.CLOUDFLARE_TURNSTILE_SITE_KEY,
        CONTROLLED_ENVIRONMENT: process.env.CONTROLLED_ENVIRONMENT,
        DOMAIN: "carbon.ms",
        EXCHANGE_RATES_API_KEY: process.env.EXCHANGE_RATES_API_KEY,
        NOVU_APPLICATION_ID: process.env.NOVU_APPLICATION_ID,
        NOVU_SECRET_KEY: process.env.NOVU_SECRET_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY: process.env.POSTHOG_PROJECT_PUBLIC_KEY,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        SESSION_SECRET: process.env.SESSION_SECRET,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
        SLACK_OAUTH_REDIRECT_URL: process.env.SLACK_OAUTH_REDIRECT_URL,
        SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
        SLACK_STATE_SECRET: process.env.SLACK_STATE_SECRET,
        STRIPE_BYPASS_COMPANY_IDS: process.env.STRIPE_BYPASS_COMPANY_IDS,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_ANON_PUBLIC: process.env.SUPABASE_ANON_PUBLIC,
        SUPABASE_API_URL: process.env.SUPABASE_API_URL,
        SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL: process.env.SUPABASE_URL,
        TRIGGER_API_URL: process.env.TRIGGER_API_URL,
        TRIGGER_PROJECT_ID: process.env.TRIGGER_PROJECT_ID,
        TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        VERCEL_ENV: "production",
        VERCEL_URL: process.env.URL_ERP ?? "itar.carbon.ms",
      },
    });

    const mes = cluster.addService("CarbonMESService", {
      image: `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.us-gov-east-1.amazonaws.com/carbon/mes:latest`,
      loadBalancer: {
        domain: {
          name: "mes.itar.carbon.ms",
          dns: false,
          cert: process.env.CERT_ARN_MES,
        },
        rules: [
          { listen: "80/http", redirect: "443/https" },
          { listen: "443/https", forward: "3000/http" },
        ],
      },
      environment: {
        AUTODESK_BUCKET_NAME: process.env.AUTODESK_BUCKET_NAME,
        AUTODESK_CLIENT_ID: process.env.AUTODESK_CLIENT_ID,
        AUTODESK_CLIENT_SECRET: process.env.AUTODESK_CLIENT_SECRET,
        CARBON_EDITION: process.env.CARBON_EDITION,
        CLOUDFLARE_TURNSTILE_SECRET_KEY:
          process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
        CLOUDFLARE_TURNSTILE_SITE_KEY:
          process.env.CLOUDFLARE_TURNSTILE_SITE_KEY,
        CONTROLLED_ENVIRONMENT: process.env.CONTROLLED_ENVIRONMENT,
        DOMAIN: "carbon.ms",
        EXCHANGE_RATES_API_KEY: process.env.EXCHANGE_RATES_API_KEY,
        NOVU_APPLICATION_ID: process.env.NOVU_APPLICATION_ID,
        NOVU_SECRET_KEY: process.env.NOVU_SECRET_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY: process.env.POSTHOG_PROJECT_PUBLIC_KEY,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        SESSION_SECRET: process.env.SESSION_SECRET,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_ANON_PUBLIC: process.env.SUPABASE_ANON_PUBLIC,
        SUPABASE_API_URL: process.env.SUPABASE_API_URL,
        SUPABASE_SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_URL: process.env.SUPABASE_URL,
        TRIGGER_API_URL: process.env.TRIGGER_API_URL,
        TRIGGER_PROJECT_ID: process.env.TRIGGER_PROJECT_ID,
        TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        VERCEL_ENV: "production",
        VERCEL_URL: process.env.URL_MES ?? "mes.itar.carbon.ms",
      },
    });

    const rateLimitRule = {
      name: "RateLimitRule",
      statement: {
        rateBasedStatement: {
          limit: 200,
          aggregateKeyType: "IP",
        },
      },
      priority: 1,
      action: { block: {} },
      visibilityConfig: {
        cloudwatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: "CarbonRateLimitRule",
      },
    };

    const awsManagedRules = {
      name: "AWSManagedRules",
      statement: {
        managedRuleGroupStatement: {
          name: "AWSManagedRulesCommonRuleSet",
          vendorName: "AWS",
        },
      },
      priority: 2,
      overrideAction: {
        none: {},
      },
      visibilityConfig: {
        cloudwatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: "MyAppAWSManagedRules",
      },
    };

    // WAF configuration kept for manual association with load balancer
    // To use: Associate this WAF ACL with your manually created load balancer in AWS Console
    new aws.wafv2.WebAcl("AppAlbWebAcl", {
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudwatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: "AppAlbWebAcl",
      },
      rules: [rateLimitRule, awsManagedRules],
    });

    return {};
  },
});
