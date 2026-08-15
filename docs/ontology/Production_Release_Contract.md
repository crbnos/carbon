# ProductionRelease Contract (v1)

## Purpose

Define the minimal handoff object from planning systems into Factory OS.

## Type contract

```ts
type QuantityValue = {
  value: number;
  unit?: string;
};

interface ProductionRelease {
  id: string;
  factoryObjectId: string;
  source: SourceReference; // required: system/object/record
  productionOrder: {
    sourceId: string; // required planning source id
    itemRef?: string;
    plannedQuantity?: QuantityValue;
  };
  operations?: readonly {
    sourceId: string;
    sequence?: number;
    plannedQuantity?: QuantityValue;
    operationQuantity?: QuantityValue;
  }[];
  plannedStart?: string;
  plannedFinish?: string;
  issuedAt?: string;
  version: "1" | "1.0";
}
```

## Required/allowed semantics (v1)

- required:
  - `id`, `factoryObjectId`, `source.system/objectType/recordId`, `productionOrder.sourceId`
- allowed:
  - optional quantities if finite and non-negative
  - optional operations with optional stable identifiers
  - optional date metadata
  - fixed release version (`1` or `1.0`)

## Validation behavior

Implemented in `validateProductionRelease()`:

- required identity fields must be present
- `plannedQuantity`, `operation.plannedQuantity`, `operation.operationQuantity` must be finite and non-negative when present
- release version must be supported

`unsupported / unknown-safe` policy:
- missing optional fields are tolerated
- no defaulting or synthetic completion metric
