import type { AssemblySpec } from "../../types.ts";

// Animated 3D work instructions over the bundled CAD assembly. The node ids
// are graph.json keys from that exact file — see assets/ATTRIBUTION.md.
// Ordered base-outward, the way the arm is actually stacked up.
export const roboticsAssembly: AssemblySpec = {
  model: "robot-arm",
  name: "Koch Robot Arm — Final Assembly",
  item: "ROB-2000",
  componentCount: 163,
  steps: [
    {
      title: "Bolt the base to the work plate",
      instruction:
        "Fix the base down and check it sits flat — rock it by hand at all four corners. Every joint above this one inherits whatever tilt is left here, and it cannot be dialled out later in software.",
      componentNodeIds: ["cf90798128911226"]
    },
    {
      title: "Fit the two XL-430 shoulder servos",
      instruction:
        "Set these to IDs 1 and 2 and drive both to position 2048 on the bench BEFORE they go in. A servo fitted off-centre loses half its travel, and re-zeroing it means stripping the joint back out.",
      componentNodeIds: ["bbdf3fbb122539bb", "3f40df96e4bc7b7e"]
    },
    {
      title: "Fit the shoulder angle bracket",
      instruction:
        "Bring the angle bracket onto the servo horn and start all screws before tightening any. Cycle the joint through its full sweep by hand and confirm it clears the base at both ends of travel.",
      componentNodeIds: ["5d4de3b2bf2d1f0f"]
    },
    {
      title: "Join the upper arm link",
      instruction:
        "Fit the XL430-to-XL330 link, feeding the servo cable through the channel as you close it rather than after. A cable pulled through a closed link chafes at the horn and shorts the bus.",
      componentNodeIds: ["fdd2780db5fa1b6c"]
    },
    {
      title: "Fit the three XL-330 arm servos",
      instruction:
        "IDs 3, 4 and 5, each centred at 2048 on the bench first. Confirm all five servos answer on the bus before the harness is dressed — a dead ID found now costs a minute, found at test it costs the arm.",
      componentNodeIds: [
        "b8dcfe52f5a1c46b",
        "dd853edcb826b859",
        "0f17101f736b4831"
      ]
    },
    {
      title: "Fit the wrist rotation link",
      instruction:
        "Seat the rotation link and leave a service loop in the cable at the joint. Rotate the wrist lock to lock and watch the loop — it should take up slack, never go taut.",
      componentNodeIds: ["120fdac57f58744e"]
    },
    {
      title: "Fit the forearm straight link",
      instruction:
        "Close the straight link between the wrist and the gripper mount. Check the two horns are square to each other before the screws go tight; a twist here shows up as a gripper that closes off-axis.",
      componentNodeIds: ["fb9935505c29d908"]
    },
    {
      title: "Fit the gripper and check jaw travel",
      instruction:
        "Mount the gripper last. Drive the jaws fully open and fully closed and confirm they meet flat with no gap at the tips. Record the closed position — it is the zero the pick routine is taught against.",
      componentNodeIds: ["ad6addc72d92757d"]
    }
  ]
};
