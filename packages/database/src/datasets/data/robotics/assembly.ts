import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
export const roboticsAssembly: AssemblySpec = {
  model: "robot-arm",
  name: "Koch Robot Arm — Final Assembly",
  item: "ROB-2000",
  componentCount: 163,
  steps: [
    {
      title: "Install XL-430 new",
      componentNodeIds: ["bbdf3fbb122539bb", "3f40df96e4bc7b7e"]
    },
    {
      title: "Install XL,XC-330",
      componentNodeIds: [
        "b8dcfe52f5a1c46b",
        "dd853edcb826b859",
        "0f17101f736b4831"
      ]
    },
    { title: "Install Simple Base", componentNodeIds: ["cf90798128911226"] },
    {
      title: "Install Servo connector angle",
      componentNodeIds: ["5d4de3b2bf2d1f0f"]
    },
    {
      title: "Install XL430 to XL330 new connector",
      componentNodeIds: ["fdd2780db5fa1b6c"]
    },
    {
      title: "Install Rotation connector",
      componentNodeIds: ["120fdac57f58744e"]
    },
    { title: "Install Gripper", componentNodeIds: ["ad6addc72d92757d"] },
    {
      title: "Install XL330 to XL330 straight",
      componentNodeIds: ["fb9935505c29d908"]
    }
  ]
};
