import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
export const motorAssembly: AssemblySpec = {
  model: "ev-drive-unit",
  name: "EV Drive Unit — Build Sequence",
  item: "MTR-9000",
  componentCount: 53,
  steps: [
    {
      title: "Set the rotor shaft into the case",
      instruction:
        "Lower the rotor shaft in drive-end down, supporting it by the shaft and never by the magnets. The 6208 bearing must seat the last 2mm under hand pressure — if it needs tapping, the bore is not square and the shaft comes back out.",
      componentNodeIds: ["6de0ee0cd9763f34"]
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
      componentNodeIds: ["c227f36952b482ec"]
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
      componentNodeIds: ["b60a9d16191bdd92"]
    }
  ]
};
