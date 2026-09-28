import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
export const motorAssembly: AssemblySpec = {
  model: "ev-drive-unit",
  name: "EV Drive Unit — Build Sequence",
  item: "MTR-9000",
  componentCount: 53,
  // The Assembly operation of the MTR-9000 method.
  operation: 1,
  steps: [
    {
      title: "Set the rotor shaft into the case",
      instruction:
        "Lower the rotor shaft in drive-end down, supporting it by the shaft and never by the magnets. The 6208 bearing must seat the last 2mm under hand pressure — if it needs tapping, the bore is not square and the shaft comes back out.",
      componentNodeIds: ["6de0ee0cd9763f34"],
      materials: [
        { item: "ROT-9000", quantity: 1 },
        { item: "BRG-6308-C3", quantity: 1 }
      ],
      tools: [{ item: "TL-ARBOR-PRESS", quantity: 1 }]
    },
    {
      title: "Roll the counter shaft into mesh",
      instruction:
        "Bring the counter shaft into mesh with the rotor pinion. Measure backlash at three points 120° apart — all three must read 0.08–0.15mm. Re-shim if any point falls outside; an uneven reading means the shaft is not parallel.",
      componentNodeIds: ["a7f1740d11e2ecb9"]
    },
    {
      title: "Seat the output gear and differential",
      instruction:
        "Drop the output gear and differential group onto their bearing bores. Turn the rotor one full revolution by hand: the whole train must run free with no tight spot. A tight spot here is a misaligned bore, not a run-in issue.",
      componentNodeIds: ["c227f36952b482ec"],
      materials: [{ item: "BRG-6308-C3", quantity: 1 }]
    },
    {
      title: "Fit the short axle shaft",
      instruction:
        "Push the short axle through the differential until the circlip snaps into its groove. Pull firmly on the flange to confirm it is captured — a clip that only looks seated will walk out under torque.",
      componentNodeIds: ["8f13a7f7131ef51d"]
    },
    {
      title: "Fit the long axle shaft and check end float",
      instruction:
        "Fit the long axle the same way, then dial-indicate end float at both output flanges. 0.05–0.20mm each side. Record both readings on the traveler before the case halves go together.",
      componentNodeIds: ["b60a9d16191bdd92"],
      materials: [{ item: "ENC-INC-2048", quantity: 1 }],
      tools: [{ item: "TL-BAL-MANDREL", quantity: 1 }]
    }
  ],
  componentMappings: [
    // model part "rotor shaft"
    {
      geometryHash: "2ba110d7ca24b04bdd9b1b8a4d4972be1b5315b7",
      item: "ROT-9000"
    },
    // model part "6308 bearing"
    {
      geometryHash: "f3596194138d8700a03701246925e34897bb07e2",
      item: "BRG-6308-C3"
    },
    // model part "resolver"
    {
      geometryHash: "f5192d79c105b37223aeee05dabcdebf7a9106e1",
      item: "ENC-INC-2048"
    }
  ]
};
