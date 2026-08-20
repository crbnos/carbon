import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
export const satelliteAssembly: AssemblySpec = {
  model: "radial-engine",
  name: "Radial Engine — Build Sequence",
  item: "SAT-1000",
  componentCount: 266,
  steps: [
    { title: "Install Cone Assembly", componentNodeIds: ["7018fb918f1b1be6"] },
    { title: "Install Crankcase", componentNodeIds: ["3bc7311d9d4c8ffc"] },
    {
      title: "Install Cover Crankcase",
      componentNodeIds: ["95451b53f10c23c3"]
    },
    {
      title: "Install Piston Assembly",
      componentNodeIds: ["85cd37602cfc85ea"]
    },
    {
      title: "Install Engine Barrel",
      componentNodeIds: [
        "da008d43e97f4aa6",
        "44d442e8db5e0987",
        "cd9b2aed498aa26b",
        "d6f9c46ffc3eaabe",
        "3dc65b37b1d4f03e"
      ]
    },
    {
      title: "Install Head Gasket",
      componentNodeIds: [
        "7218480880f48807",
        "0ff0f158d5f068ac",
        "f567c75f3ce83cd6",
        "19ff499b9d317a23",
        "7c95eded5c8d739a"
      ]
    },
    {
      title: "Install Cylinder Head Assembly",
      componentNodeIds: [
        "1ea2071899b19cb1",
        "99b4d51abc675177",
        "192567d4cbb32726",
        "f79c31a08ad60625",
        "dfc33a292d0882ed"
      ]
    },
    { title: "Install Came Housing", componentNodeIds: ["61c5b3be6fbdce0a"] }
  ]
};
