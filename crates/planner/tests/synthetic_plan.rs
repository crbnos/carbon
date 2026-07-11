//! Planner core tests over synthetic geometry — no STEP/OCCT/fixtures, meshes
//! built in code. Mirrors the spirit of the former Python planner's test_plan:
//! assert plan behavior (sequencing, tiers, ordering invariants), not byte
//! output. Kept to robust invariants that any correct plan must satisfy, so
//! they don't wobble on exact float geometry.

use nalgebra::Vector3;
use planner::pipeline2::plan_parts;
use planner::types::{Component, Mesh, Motion};

/// Axis-aligned box: 8 corners, 12 triangles. `extents` are full side lengths.
fn box_part(node_id: &str, extents: [f64; 3], center: [f64; 3]) -> Component {
    let h = [extents[0] / 2.0, extents[1] / 2.0, extents[2] / 2.0];
    let mut verts = Vec::with_capacity(8);
    for &sz in &[-1.0f64, 1.0] {
        for &sy in &[-1.0f64, 1.0] {
            for &sx in &[-1.0f64, 1.0] {
                verts.push(Vector3::new(
                    center[0] + sx * h[0],
                    center[1] + sy * h[1],
                    center[2] + sz * h[2],
                ));
            }
        }
    }
    // Corner index bits: bit0=x, bit1=y, bit2=z.
    let faces: Vec<[u32; 3]> = vec![
        [0, 1, 3], [0, 3, 2],
        [4, 7, 5], [4, 6, 7],
        [0, 4, 5], [0, 5, 1],
        [2, 3, 7], [2, 7, 6],
        [0, 2, 6], [0, 6, 4],
        [1, 5, 7], [1, 7, 3],
    ];
    let mesh = Mesh { vertices: verts, faces };
    let (lo, hi) = mesh.bbox();
    Component::new(node_id.to_string(), node_id.to_string(), mesh, lo, hi, false)
}

fn plan(parts: Vec<Component>) -> planner::pipeline2::PlanOutcome {
    let mut warnings = Vec::new();
    plan_parts(parts, 0.5, 40, 0.15, None, &mut warnings)
}

fn tier(outcome: &planner::pipeline2::PlanOutcome, key: &str) -> i64 {
    outcome.tiers.get(key).copied().unwrap_or(0)
}

#[test]
fn free_parts_all_plan_cleanly() {
    // Three well-separated boxes — all trivially removable, none flagged.
    let outcome = plan(vec![
        box_part("a", [4.0, 4.0, 4.0], [0.0, 0.0, 0.0]),
        box_part("b", [4.0, 4.0, 4.0], [20.0, 0.0, 0.0]),
        box_part("c", [4.0, 4.0, 4.0], [40.0, 0.0, 0.0]),
    ]);
    assert_eq!(outcome.sequence.len(), 3, "all three sequenced");
    assert_eq!(tier(&outcome, "forced"), 0);
    assert_eq!(tier(&outcome, "flagged"), 0);
    assert_eq!(tier(&outcome, "unplanned"), 0);
    // A part with a free direction gets a real linear motion.
    let any_linear = outcome
        .planned
        .iter()
        .any(|p| matches!(p.motion, Motion::Linear { .. }));
    assert!(any_linear, "at least one free part removed by a linear motion");
}

#[test]
fn stacked_boxes_top_removed_before_base() {
    // Base on the ground, top seated on it. Whatever the exact motion, the top
    // must be sequenced before the base it rests on, and nothing is unplanned.
    let base = box_part("base", [10.0, 10.0, 4.0], [0.0, 0.0, 2.0]);
    let top = box_part("top", [10.0, 10.0, 4.0], [0.0, 0.0, 6.05]);
    let outcome = plan(vec![base, top]);

    assert_eq!(tier(&outcome, "unplanned"), 0, "both parts planned");
    let pos = |id: &str| outcome.sequence.iter().position(|s| s == id);
    let (top_i, base_i) = (pos("top"), pos("base"));
    assert!(top_i.is_some() && base_i.is_some(), "both in sequence");
    assert!(top_i < base_i, "top removed before base: {:?}", outcome.sequence);
}

#[test]
fn every_planned_part_is_sequenced_once() {
    // Structural invariant: the sequence is a permutation of the planned set —
    // no dropped or duplicated components.
    let outcome = plan(vec![
        box_part("p0", [6.0, 6.0, 4.0], [0.0, 0.0, 2.0]),
        box_part("p1", [6.0, 6.0, 4.0], [0.0, 0.0, 6.05]),
        box_part("p2", [4.0, 4.0, 4.0], [30.0, 0.0, 0.0]),
    ]);
    let mut seq = outcome.sequence.clone();
    seq.sort();
    seq.dedup();
    assert_eq!(seq.len(), outcome.sequence.len(), "no duplicate in sequence");
    assert_eq!(outcome.sequence.len(), 3, "all components sequenced");
    assert_eq!(tier(&outcome, "unplanned"), 0);
}
