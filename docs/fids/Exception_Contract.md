# Exception Contract

## Purpose

`FactoryException` represents a condition requiring awareness, investigation, decision or action. It is not merely a red card.

Implementation: `packages/utils/src/fids.ts`; rendered by `packages/react/src/ExceptionCard.tsx`.

## Required semantics

| Field | Meaning |
|---|---|
| `id` / `type` | Stable exception identity and typed kind |
| `severity` | Exception severity only: critical/high/medium/low/unknown |
| `subject` / `affectedObjects` | Object(s) involved |
| `summary` / `facts` | Human summary and structured observed facts |
| `inferredCause` | Explicit inference with optional confidence |
| `impact` / `owner` | Optional supplied impact and accountable owner |
| `evidenceRefs` | Supporting evidence IDs |
| `recommendations` / `actionRefs` | Advisory text and future action references |
| `lifecycle` | open/acknowledged/investigating/decision-required/action-pending/resolved/dismissed/unknown |

## Fact, inference and recommendation

The contract uses separate fields and the component renders separate labelled sections. A cause is not a fact merely because it is plausible; recommendations do not imply approval or execution. Missing fields are omitted.

## Separation rules

Object status, risk level and exception severity are different dimensions and different enums. For example, an operation may be `in-progress`, have `high` risk and have a `critical` exception simultaneously.

## Open questions

Lifecycle ownership, severity thresholds, owner identity and action authorization require Factory OS governance confirmation. P0.5 does not modify ERP/MES workflows.
