# P1 Role Context

P1 displays only roles already present in authenticated route data:

- `employee`
- `supplier`
- `customer`

Owner status is displayed as a secondary qualifier when the existing permission
source reports it. P1 intentionally does not relabel an employee as Executive,
Planner, or Operator because those distinctions are not represented by the
current source role contract. Role-sensitive navigation continues to use
`usePermissions().can("view", feature)`.

The shell therefore communicates context without inventing authority. Permission
filtering remains enforced by the existing route loaders and is not replaced by
client-only hiding.
