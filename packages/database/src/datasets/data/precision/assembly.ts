import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
export const precisionAssembly: AssemblySpec = {
  model: "extruder-toolhead",
  name: "Extruder Toolhead — Final Assembly",
  item: "HMA-4000",
  componentCount: 70,
  steps: [
    {
      title: "Install Tool plate assembly with bondtech extruder",
      componentNodeIds: ["650820861e3f30a9"]
    },
    {
      title: "Install M3 10mm buttonhead screw",
      componentNodeIds: [
        "630dcdcdfb74162f",
        "9043b5f1858554fc",
        "1cee1613d32ea10f",
        "71f3409064e10444"
      ]
    },
    {
      title: "Install Mounted extruder assembly",
      componentNodeIds: ["7074c6c564d4c09d"]
    },
    {
      title: "Install 1.75mm bowden tube adaptor",
      componentNodeIds: ["aac8ae0dc80653bf"]
    },
    {
      title: "Install M3 8mm buttonhead screw",
      componentNodeIds: ["547bb2f5132c1933", "23318994b4c3d0b1"]
    },
    {
      title: "Install Fan with shroud 5015",
      componentNodeIds: ["b9d4cb1e0a50bacf"]
    }
  ]
};
