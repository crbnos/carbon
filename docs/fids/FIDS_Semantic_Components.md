# FIDS Semantic Components

## Reasoning contract

Every component follows Role → Object → Relationship → Process → State → Exception → Decision → Action → Evidence → UI. Props represent supplied facts; components never invent business meaning.

## ObjectHeader

Canonical object identity: object type, ID, name, status, separate risk, metadata and composed actions. It is object-agnostic and reflows without dropping semantics.

## StatusBadge

Typed presentation states: `normal`, `in-progress`, `completed`, `warning`, `blocked`, `critical`, `cancelled`, `unknown`. Text and icon prevent color-only communication. Unknown plus a raw label remains visibly “Unknown”. Source mapping is governed by the canonical registry.

## RiskIndicator

Typed assessed levels: `high`, `medium`, `low`, `none`, `unknown`. `none` means an explicit assessment of no current risk; `unknown` means unassessed/unavailable. Risk never stands in for lifecycle status. Caller labels cannot hide unknown assessment.

## ExceptionCard

Separates the observed fact, known cause or inference, and recommendation. Location, impact, owner, recommendation and action are optional and are omitted rather than fabricated.

## EvidencePanel

Displays business-readable evidence with source, business object/reference, fact, timestamp, freshness, version and provenance. Missing timestamps force unknown freshness even if the caller supplied `fresh`.

## Composition rules

- Import from `@carbon/react`; pass application data through typed props.
- Use shared actions/controls as children instead of growing component APIs.
- Retain raw source state and provenance outside presentation normalization.
- Do not couple these components to Production Order 360, routing, fetching or writes.
