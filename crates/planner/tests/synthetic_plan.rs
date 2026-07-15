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
        [0, 1, 3],
        [0, 3, 2],
        [4, 7, 5],
        [4, 6, 7],
        [0, 4, 5],
        [0, 5, 1],
        [2, 3, 7],
        [2, 7, 6],
        [0, 2, 6],
        [0, 6, 4],
        [1, 5, 7],
        [1, 7, 3],
    ];
    let mesh = Mesh {
        vertices: verts,
        faces,
    };
    let (lo, hi) = mesh.bbox();
    Component::new(
        node_id.to_string(),
        node_id.to_string(),
        mesh,
        lo,
        hi,
        false,
    )
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
    assert!(
        any_linear,
        "at least one free part removed by a linear motion"
    );
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
    assert!(
        top_i < base_i,
        "top removed before base: {:?}",
        outcome.sequence
    );
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
    assert_eq!(
        seq.len(),
        outcome.sequence.len(),
        "no duplicate in sequence"
    );
    assert_eq!(outcome.sequence.len(), 3, "all components sequenced");
    assert_eq!(tier(&outcome, "unplanned"), 0);
}

#[test]
fn detects_a_pcb_detail_swarm_and_excludes_fasteners() {
    use planner::pipeline2::detect_swarm_units;
    use std::collections::HashSet;

    // A populated board: 100x80 plate with 20 tiny components seated on its top
    // face — plus a far-away bracket carrying 8 tiny screw-named parts (a lid
    // shape that must NOT become a swarm: fastener-named parts never join).
    let mut parts = vec![box_part("board", [100.0, 80.0, 1.6], [0.0, 0.0, 0.8])];
    for i in 0..20 {
        let x = -45.0 + 4.5 * i as f64;
        parts.push(box_part(&format!("c{i}"), [2.0, 1.0, 1.0], [x, 10.0, 2.1]));
    }
    parts.push(box_part("bracket", [60.0, 60.0, 3.0], [220.0, 0.0, 1.5]));
    for i in 0..8 {
        let x = 195.0 + 7.0 * i as f64;
        parts.push(box_part(
            &format!("m3 screw {i}"),
            [2.0, 2.0, 2.0],
            [x, 0.0, 4.0],
        ));
    }

    let specs = detect_swarm_units(&parts, &HashSet::new());
    assert_eq!(specs.len(), 1, "exactly one swarm: {specs:?}");
    let (id, name, node_ids) = &specs[0];
    assert_eq!(id, "swarm:board");
    assert_eq!(name.as_deref(), Some("board"));
    assert_eq!(node_ids.len(), 21, "board + 20 components");
    assert!(node_ids.iter().all(|n| !n.contains("screw")));
}

#[test]
fn mid_size_parts_on_a_rail_are_not_a_swarm() {
    use planner::pipeline2::detect_swarm_units;
    use std::collections::HashSet;

    // Packing-Arm shape: a long rail in a LARGE assembly carrying 14 mid-size
    // parts. They are tiny vs the assembly (~4%) but NOT dwarfed by the host
    // (~23% of its diagonal) — real hand-assembled parts, not a PCB swarm.
    let mut parts = vec![box_part("rail", [180.0, 40.0, 10.0], [0.0, 0.0, 5.0])];
    for i in 0..14 {
        let x = -78.0 + 12.0 * i as f64;
        parts.push(box_part(
            &format!("roller{i}"),
            [25.0, 15.0, 12.0],
            [x, 0.0, 16.05],
        ));
    }
    // A distant part stretches the assembly bounds (mimics the wide machine).
    parts.push(box_part("far", [40.0, 40.0, 40.0], [650.0, 0.0, 20.0]));

    let specs = detect_swarm_units(&parts, &HashSet::new());
    assert!(specs.is_empty(), "no swarm expected: {specs:?}");
}

#[cfg(test)]
mod waves {
    use planner::pipeline2::compute_waves;
    use std::collections::{HashMap, HashSet};

    fn edges(pairs: &[(&str, &[&str])]) -> HashMap<String, HashSet<String>> {
        // Every node that appears must be a key (derive_precedence seeds all).
        let mut e: HashMap<String, HashSet<String>> = HashMap::new();
        for (k, vs) in pairs {
            e.entry(k.to_string()).or_default();
            for v in *vs {
                e.entry(v.to_string()).or_default();
                e.get_mut(*k).unwrap().insert(v.to_string());
            }
        }
        e
    }

    #[test]
    fn linear_chain_levels_incrementally() {
        // a -> b -> c  (a before b before c)
        let w = compute_waves(&edges(&[("a", &["b"]), ("b", &["c"])]));
        assert_eq!(w["a"], 0);
        assert_eq!(w["b"], 1);
        assert_eq!(w["c"], 2);
    }

    #[test]
    fn diamond_shares_a_middle_wave() {
        // a -> b, a -> c, b -> d, c -> d
        let w = compute_waves(&edges(&[("a", &["b", "c"]), ("b", &["d"]), ("c", &["d"])]));
        assert_eq!(w["a"], 0);
        assert_eq!(w["b"], 1);
        assert_eq!(w["c"], 1); // b and c: same wave, no constraint between them
        assert_eq!(w["d"], 2);
    }

    #[test]
    fn independent_parts_are_all_wave_zero() {
        let w = compute_waves(&edges(&[("a", &[]), ("b", &[]), ("c", &[])]));
        assert_eq!(w["a"], 0);
        assert_eq!(w["b"], 0);
        assert_eq!(w["c"], 0);
    }

    #[test]
    fn cycle_nodes_get_no_wave() {
        // a -> b -> a is a cycle; c is a clean root
        let w = compute_waves(&edges(&[("a", &["b"]), ("b", &["a"]), ("c", &[])]));
        assert!(!w.contains_key("a"));
        assert!(!w.contains_key("b"));
        assert_eq!(w["c"], 0);
    }
}
