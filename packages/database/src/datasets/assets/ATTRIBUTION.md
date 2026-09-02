# Demo dataset CAD model attribution

The `<industryId>/models/*.glb` files are converted from third-party CAD assemblies.
Three of the four licenses **require attribution when the work is redistributed**, and
shipping these files in the app is redistribution — so this notice must stay with them,
and the credits must remain reachable from the product.

Each `.glb` was produced by running the upstream STEP file once through
`apps/assembler` (`POST /v1/convert`, `linearDeflection: 2.0`, `angularDeflection: 1.0`).
The geometry is a decimated derivative of the original; nothing else was changed. The
STEP sources are deliberately NOT committed — see
`.ai/plans/2026-08-20-demo-cad-models.md` for how to re-bake.

| File | Upstream work | Author | License |
|---|---|---|---|
| `robotics_oem/models/robot-arm.glb` | [low_cost_robot](https://github.com/AlexanderKoch-Koch/low_cost_robot) follower arm | Alexander Koch | MIT |
| `precision_manufacturing/models/extruder-toolhead.glb` | [Jubilee](https://github.com/machineagency/jubilee) Bondtech groovemount extruder | Joshua Vasquez / Machine Agency | CC BY 4.0 |
| `aerospace_satellite/models/radial-engine.glb` | [Radial-Engine](https://github.com/SivakumarThirumurugan/Radial-Engine) | Sivakumar Thirumurugan | MIT |
| `automotive_precision/models/ev-drive-unit.glb` | [Chevrolet Bolt EV Drivetrain Teardown](https://doi.org/10.5683/SP3/LM35Z2) | McMaster University Automotive Research | CC0 1.0 (repository metadata) / CC BY 4.0 (bundled README) |

## Known caveats

- **`robot-arm`** embeds ROBOTIS Dynamixel servo geometry that Koch redistributed. The MIT
  grant covers Koch's own work; the servo solids are third-party vendor models.
- **`extruder-toolhead`** embeds McMaster-Carr vendor part models.
- **`ev-drive-unit`** is a reverse-engineered teardown of a General Motors production
  product. The depositors certify the data is free of IP encumbrance, but design-right
  exposure is a business judgement that the CC0 grant does not settle. Its two license
  statements disagree (CC0 vs CC BY); both permit commercial redistribution, so the
  conflict is harmless, but treat CC BY as the binding one and keep the credit above.
