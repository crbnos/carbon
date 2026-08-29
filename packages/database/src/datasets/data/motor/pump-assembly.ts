import type { AssemblySpec } from "../../types.ts";

const impellerNodes = [
  "node-impeller-00",
  "node-impeller-01",
  "node-impeller-02",
  "node-impeller-03",
  "node-impeller-04",
  "node-impeller-05",
  "node-impeller-06",
  "node-impeller-07",
  "node-impeller-08",
  "node-impeller-09",
  "node-impeller-10",
  "node-impeller-11"
] as const;

const sleeveNodes = [
  "node-sleeve-00",
  "node-sleeve-01",
  "node-sleeve-02",
  "node-sleeve-03",
  "node-sleeve-04",
  "node-sleeve-05",
  "node-sleeve-06",
  "node-sleeve-07",
  "node-sleeve-08",
  "node-sleeve-09",
  "node-sleeve-10",
  "node-sleeve-11"
] as const;

const diffuserNodes = [
  "node-diffuser-00",
  "node-diffuser-01",
  "node-diffuser-02",
  "node-diffuser-03",
  "node-diffuser-04",
  "node-diffuser-05",
  "node-diffuser-06",
  "node-diffuser-07",
  "node-diffuser-08",
  "node-diffuser-09",
  "node-diffuser-10",
  "node-diffuser-11"
] as const;

const impellerMap = Object.fromEntries(
  impellerNodes.map((node) => [node, "IMP-SEMIOPEN-001"])
);
const sleeveMap = Object.fromEntries(
  sleeveNodes.map((node) => [node, "SLEEVE-STAGE-001"])
);
const diffuserMap = Object.fromEntries(
  diffuserNodes.map((node) => [node, "DIFFUSER-STACK-001"])
);

/**
 * Industrial pump + motor 3D work instructions. Node ids are keys from
 * pump-motor-assembly.graph.json. Directions are unit vectors.
 */
export const pumpMotorAssembly: AssemblySpec = {
  model: "pump-motor-assembly",
  name: "Industrial Pump & Motor Assembly",
  item: "PUMP-MOTOR-ASSY-001",
  componentCount: 46,
  attachToMethod: true,
  nodeItemMap: {
    "node-shaft": "SHAFT-PUMP-001",
    "node-motor-housing": "MOTOR-HOUSING-001",
    "node-stator-core": "STATOR-CORE-001",
    "node-winding-de-ring": "WINDING-001",
    "node-winding-nde-ring": "WINDING-001",
    "node-rotor-cage": "ROTOR-CAGE-001",
    "node-rotor-endring-top": "ROTOR-CAGE-001",
    "node-rotor-endring-bot": "ROTOR-CAGE-001",
    "node-endbell-de": "ENDBELL-001",
    "node-endbell-nde": "ENDBELL-001",
    ...diffuserMap,
    ...impellerMap,
    ...sleeveMap
  },
  steps: [
    {
      title: "Shaft into the motor stack",
      instruction:
        "Slide the SS410 shaft through the motor bore. Check TIR under 0.015 mm.",
      componentNodeIds: ["node-shaft"],
      motion: { type: "linear", direction: [0, 0, 1], distance: 80 }
    },
    {
      title: "Rotor cage and end rings",
      instruction:
        "Press the aluminum squirrel-cage rotor and end rings onto the shaft.",
      componentNodeIds: [
        "node-rotor-cage",
        "node-rotor-endring-top",
        "node-rotor-endring-bot"
      ],
      motion: { type: "linear", direction: [0, 0, 1], distance: 160 }
    },
    {
      title: "Stator core and copper windings",
      instruction:
        "Lower the M19 stator core and end-turn windings over the rotor.",
      componentNodeIds: [
        "node-stator-core",
        "node-winding-de-ring",
        "node-winding-nde-ring"
      ],
      motion: { type: "linear", direction: [0, 0, 1], distance: 240 }
    },
    {
      title: "Drive-end and non-drive-end endbells",
      instruction: "Fit both endbells. Cross-torque fasteners to 28 Nm.",
      componentNodeIds: ["node-endbell-de", "node-endbell-nde"],
      motion: { type: "linear", direction: [0, 0, 1], distance: 280 }
    },
    {
      title: "Motor housing",
      instruction:
        "Slide the cast iron housing over the stator. Align the terminal box.",
      componentNodeIds: ["node-motor-housing"],
      motion: { type: "linear", direction: [0, 0, 1], distance: 320 }
    },
    {
      title: "Bowl diffuser stack",
      instruction:
        "Stack the bowl diffusers on the pump end. Clock each stage.",
      componentNodeIds: [...diffuserNodes],
      motion: { type: "linear", direction: [0, 0, -1], distance: 220 }
    },
    {
      title: "Stage impellers and shaft sleeves",
      instruction:
        "Install each stage impeller with its inter-stage sleeve. Lock the stack.",
      componentNodeIds: [...impellerNodes, ...sleeveNodes],
      motion: { type: "linear", direction: [0, 0, -1], distance: 360 }
    }
  ]
};
