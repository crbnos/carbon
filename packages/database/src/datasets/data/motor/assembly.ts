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
      title: "Install Rotor shaft assembly",
      componentNodeIds: ["6de0ee0cd9763f34"]
    },
    {
      title: "Install Counter shaft assembly",
      componentNodeIds: ["a7f1740d11e2ecb9"]
    },
    {
      title: "Install Output gear assembly",
      componentNodeIds: ["c227f36952b482ec"]
    },
    {
      title: "Install Axle shaft short",
      componentNodeIds: ["8f13a7f7131ef51d"]
    },
    { title: "Install Axle long shaft", componentNodeIds: ["b60a9d16191bdd92"] }
  ]
};
