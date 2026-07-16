# Model Routing Proposal: OpenRouter + Bedrock + Tiered Models

**Proposed by:** Sid (in-person discussion with Brad)
**Date:** 2026-06-28
**Status:** Awaiting Brad's approval

---

## Summary

Switch from single-model Opus-for-everything to a tiered routing setup:
- **Sonnet 4** for chat, grooming, and general work (cheap, fast, plenty capable)
- **Opus 4** for builds, problem-solving, and complex reasoning (the heavy artillery)
- **OpenRouter** as the routing layer, preferring **AWS Bedrock** (to burn AWS credits) with **Anthropic direct** as fallback

## Why

| Current | Proposed |
|---------|----------|
| Opus for everything including "hello" | Sonnet for chat, Opus for builds |
| Anthropic direct only | Bedrock-first (AWS credits) → Anthropic fallback |
| Single vendor lock-in | Vendor-agnostic via OpenRouter |
| ~$15/1M input, $75/1M output (Opus) | ~$3/1M input, $15/1M output (Sonnet) for most traffic |

## What Changes

### 1. Add OpenRouter as a provider

OpenClaw has native OpenRouter support. We add it as a provider with Bedrock preference:

```jsonc
{
  "models": {
    "mode": "merge",
    "providers": {
      "openrouter": {
        // Built-in OpenRouter plugin handles baseUrl + API adapter
        // We just need to declare the models we want
        "models": [
          {
            "id": "anthropic/claude-sonnet-4",
            "name": "Claude Sonnet 4 (via OpenRouter/Bedrock)",
            "contextWindow": 200000,
            "maxTokens": 16384
          },
          {
            "id": "anthropic/claude-opus-4",
            "name": "Claude Opus 4 (via OpenRouter/Bedrock)",
            "contextWindow": 200000,
            "maxTokens": 16384
          }
        ]
      }
    }
  }
}
```

### 2. Set Sonnet as default, Opus as fallback

```jsonc
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/anthropic/claude-sonnet-4",
        "fallbacks": [
          "anthropic/claude-sonnet-4",     // Anthropic direct fallback for Sonnet
          "anthropic/claude-opus-4-6"       // Nuclear option: direct Opus
        ]
      },
      "models": {
        "openrouter/anthropic/claude-sonnet-4": {},
        "openrouter/anthropic/claude-opus-4": {},
        "anthropic/claude-sonnet-4": {},
        "anthropic/claude-opus-4-6": {}
      }
    }
  }
}
```

### 3. Use Opus for builds/heartbeats (the important stuff)

The heartbeat config can specify a model override:

```jsonc
{
  "agents": {
    "defaults": {
      "heartbeat": {
        "every": "30m",
        "model": "openrouter/anthropic/claude-opus-4",  // Opus for agent wake loop
        // ... existing heartbeat config
      }
    }
  }
}
```

### 4. OpenRouter provider routing (Bedrock preference)

OpenRouter supports a `provider` field to prefer specific backends. We can pass this via model `params`:

```jsonc
{
  "agents": {
    "defaults": {
      "models": {
        "openrouter/anthropic/claude-sonnet-4": {
          "params": {
            "provider": {
              "order": ["Amazon Bedrock", "Anthropic"],
              "allow_fallbacks": true
            }
          }
        },
        "openrouter/anthropic/claude-opus-4": {
          "params": {
            "provider": {
              "order": ["Amazon Bedrock", "Anthropic"],
              "allow_fallbacks": true
            }
          }
        }
      }
    }
  }
}
```

## Prerequisites

1. **OpenRouter API key** — Brad needs to create an account at openrouter.ai and generate a key
2. **AWS credits linked to OpenRouter** — OpenRouter can route through Bedrock if your AWS credentials are configured on their end, OR OpenRouter itself may use Bedrock as a backend provider automatically (it routes to cheapest/fastest available)
3. **Set env var:** `OPENROUTER_API_KEY=sk-or-...`
4. **Keep existing Anthropic key** as direct fallback

## Important Notes

### What this does NOT change
- **The conductor inner loop** — that uses `claude -p` (Claude CLI) directly, which has its own auth. This proposal only affects the OpenClaw outer loop (chat, heartbeats, grooming)
- **GitHub operations** — those use the `gh` CLI with the carbon-agent token
- **Safety rails** — no changes to build concurrency, budget ceilings, or approval gates

### Bedrock via OpenRouter — how it actually works
OpenRouter acts as a unified API gateway. When you request `anthropic/claude-sonnet-4`, OpenRouter routes to whichever backend is available. You can set `provider.order` to prefer Bedrock. If your OpenRouter account has AWS Bedrock credentials linked, it'll use your Bedrock quota. Otherwise, OpenRouter uses its own Bedrock allocation and bills you through OpenRouter credits.

**To maximize AWS credit burn:** Brad should check if OpenRouter supports "bring your own Bedrock credentials" — if not, an alternative is to configure AWS Bedrock directly as an OpenClaw provider using the `bedrock-converse-stream` API adapter (OpenClaw supports this natively), with OpenRouter as the fallback layer.

### Alternative: Direct Bedrock + Anthropic fallback (no OpenRouter)

If the goal is purely burning AWS credits, we could skip OpenRouter entirely:

```jsonc
{
  "models": {
    "mode": "merge",
    "providers": {
      "bedrock": {
        "api": "bedrock-converse-stream",
        "auth": "aws-sdk",
        "region": "us-east-1",
        "models": [
          { "id": "anthropic.claude-sonnet-4-20250514-v1:0", "name": "Sonnet 4 (Bedrock)" },
          { "id": "anthropic.claude-opus-4-20250514-v1:0", "name": "Opus 4 (Bedrock)" }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "bedrock/anthropic.claude-sonnet-4-20250514-v1:0",
        "fallbacks": ["anthropic/claude-sonnet-4"]
      }
    }
  }
}
```

This uses AWS SDK auth (IAM credentials/roles) directly — no middleman, all credits burn directly.

## Recommendation

**Option A (OpenRouter):** Best if you want vendor agnosticism and easy model switching later. OpenRouter adds a small markup but gives you access to every model under one API key.

**Option B (Direct Bedrock → Anthropic fallback):** Best if the primary goal is burning AWS credits with minimal overhead. No middleman markup, direct IAM auth, OpenClaw supports it natively.

**Option C (Hybrid):** Direct Bedrock as primary, OpenRouter as secondary fallback (for models Bedrock doesn't carry), Anthropic direct as last resort. Maximum flexibility.

## Action Items for Brad

1. Decide: OpenRouter vs Direct Bedrock vs Hybrid
2. If OpenRouter: sign up, generate API key
3. If Bedrock: ensure AWS IAM credentials are available on this box (aws-sdk auth)
4. Confirm Sonnet-default / Opus-for-builds split makes sense
5. Approve, and I'll apply the config + test it

---

*Drafted by Stanley. Not applied — awaiting Brad's go-ahead.* 🛠️
