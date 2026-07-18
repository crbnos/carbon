# Reordering policy

> How each part decides when and how much to replenish: the policy and the numbers that drive planning.

Every part carries a **reordering policy** that tells planning how to replenish it. The policy decides
*when and how much*; the **replenishment system** decides whether that becomes a purchase order or a job.

## Policies

| Policy | Triggers when | Orders |
| --- | --- | --- |
| Manual Reorder | never automatically | nothing: you order by hand |
| Demand-Based Reorder | demand appears | exactly what demand needs, grouped by the demand accumulation period |
| Fixed Reorder Quantity | on-hand falls to the reorder point | a fixed reorder quantity |
| Maximum Quantity | on-hand falls to the reorder point | enough to reach the maximum inventory quantity |

## Fields

  - **Reorder point**: On-hand level that triggers a new order. *(applies to: Fixed Reorder Quantity, Maximum Quantity)*
  - **Reorder quantity**: Fixed amount to order each time. *(applies to: Fixed Reorder Quantity)*
  - **Maximum inventory quantity**: Level to top stock back up to. *(applies to: Maximum Quantity)*
  - **Minimum / maximum order quantity**: Clamp each suggested order into an orderable range. *(applies to: all)*
  - **Lot size**: Round an order up to a multiple. *(applies to: all)*
  - **Demand accumulation period**: Window that groups demand into a single order. *(applies to: Demand-Based Reorder)*

Policies are set per part, and planning can run per location — so the same part can use demand-based
reorder at one site and simple min/max at another.

## Related

  - Plan ahead See reordering policies feed the planning run that proposes jobs and POs.
  - Methods & sourcing The replenishment system that decides buy vs make.
