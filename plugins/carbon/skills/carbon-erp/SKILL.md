---
name: carbon-erp
description: Use when the user asks Carbon ERP, MES, or QMS questions — orders, inventory, jobs, quotes, purchasing, quality, or accounting — through the Carbon MCP server.
---

# Carbon ERP

The Carbon server exposes three tools. Every ERP operation goes through them.

1. `search_tools` with a short query, a module, or a classification (`READ`, `WRITE`, `DESTRUCTIVE`).
2. `describe_tool` for the one operation you will call. Read its input schema.
3. `call_tool` with that name and arguments.

`companyId` and `userId` come from the sign-in. Do not send them as arguments.

Show the classification. Wait for an explicit yes before `call_tool` on a `WRITE` or `DESTRUCTIVE` operation.

Stop on these responses:

- `401` — the sign-in is missing or expired. Ask the user to approve Carbon again.
- `403` — the identity lacks that module permission, or the company is on the Starter plan.
- `429` — wait for `Retry-After`.

This plugin talks to Carbon Cloud at `https://app.carbon.ms/api/mcp`. A private network or a controlled (ITAR) deployment is a different origin. Do not retarget this server at that origin. Those deployments use Grok Build or Cursor on a computer that can already open the origin.
