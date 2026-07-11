//! Replay the `greedy` shadow-corpus cases through the Rust planner and assert
//! semantic parity with the Python outcome. Corpus dir via env GEOMETRY_CORPUS
//! (skips if unset, like the Python OCP-gated tests).

use planner::corpus::RawCase;
use planner::greedy::greedy_disassembly;
use planner::types::{Component, Motion, PlannedComponent};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

fn motion_matches(got: &Motion, expected: &Value) -> Result<(), String> {
    let ty = expected.get("type").and_then(|v| v.as_str()).unwrap_or("?");
    let eps = 1e-6;
    match (got, ty) {
        (Motion::None, "none") => Ok(()),
        (Motion::Linear { direction, distance }, "linear") => {
            let ed: Vec<f64> = expected["direction"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
            let edd = expected["distance"].as_f64().unwrap();
            if (distance - edd).abs() > eps {
                return Err(format!("linear distance rust={distance} py={edd}"));
            }
            // Direction sign is arbitrary iff both senses are equally clear:
            // when geometry forces the sign, Python and Rust (same FCL) agree.
            // So an exact match, or an exact global sign flip with the SAME
            // distance, is semantic parity.
            let same = (0..3).all(|i| (direction[i] - ed[i]).abs() <= eps);
            let flipped = (0..3).all(|i| (direction[i] + ed[i]).abs() <= eps);
            if same || flipped {
                Ok(())
            } else {
                Err(format!("linear dir rust={:?} py={:?}", direction, ed))
            }
        }
        (Motion::L { segments }, "L") => {
            let es = expected["segments"].as_array().unwrap();
            if segments.len() != es.len() {
                return Err(format!("L segs rust={} py={}", segments.len(), es.len()));
            }
            for (i, seg) in segments.iter().enumerate() {
                let ed: Vec<f64> = es[i]["direction"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
                let edd = es[i]["distance"].as_f64().unwrap();
                for k in 0..3 {
                    if (seg.direction[k] - ed[k]).abs() > eps {
                        return Err(format!("L seg{i} dir[{k}] rust={} py={}", seg.direction[k], ed[k]));
                    }
                }
                if (seg.distance - edd).abs() > eps {
                    return Err(format!("L seg{i} dist rust={} py={}", seg.distance, edd));
                }
            }
            Ok(())
        }
        _ => Err(format!("motion type rust={} py={ty}", got.type_str())),
    }
}

fn check_case(case: &RawCase) -> Result<(), String> {
    let parts: Vec<Component> = case.components.iter().map(Component::from_raw).collect();
    let path_samples = case.params.path_samples.unwrap_or(60);
    let tolerance = case.tolerance();

    let mut group_units = HashMap::new();
    let mut late_merges = HashMap::new();
    let mut warnings = Vec::new();
    let empty: HashSet<String> = HashSet::new();
    let (planned, sequence, tiers) = greedy_disassembly(
        &parts,
        case.params.clearance.unwrap_or(0.5),
        path_samples,
        tolerance,
        &HashMap::new(),
        &empty,
        &empty,
        None,
        &mut group_units,
        &mut late_merges,
        &mut warnings,
    );

    // sequence
    if sequence != case.result.sequence {
        return Err(format!("sequence rust={:?} py={:?}", sequence, case.result.sequence));
    }
    // tiers (compare the keys Python tracks)
    for (k, ev) in &case.result.tiers {
        let gv = *tiers.get(k).unwrap_or(&0);
        if gv != *ev {
            return Err(format!("tier[{k}] rust={gv} py={ev}"));
        }
    }
    // per-node tier + motion
    let by_id: HashMap<&str, &PlannedComponent> =
        planned.iter().map(|p| (p.node_id.as_str(), p)).collect();
    for ep in &case.result.planned {
        let gp = by_id
            .get(ep.node_id.as_str())
            .ok_or_else(|| format!("missing planned node {}", ep.node_id))?;
        if gp.tier.as_deref() != ep.tier.as_deref() {
            return Err(format!("[{}] tier rust={:?} py={:?}", ep.node_id, gp.tier, ep.tier));
        }
        motion_matches(&gp.motion, &ep.motion)
            .map_err(|e| format!("[{}] {e}", ep.node_id))?;
    }
    Ok(())
}

#[test]
fn replay_greedy_corpus() {
    // The corpus captures the PYTHON planner's outcomes — replay in compat mode
    // (the improved default algorithm intentionally diverges from Python).
    std::env::set_var("GEOMETRY_COMPAT", "python");
    let dir = match std::env::var("GEOMETRY_CORPUS") {
        Ok(d) => d,
        Err(_) => {
            eprintln!("GEOMETRY_CORPUS unset; skipping corpus replay");
            return;
        }
    };
    let mut total = 0;
    let mut failures = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.contains("greedy") || !name.ends_with(".json") {
            continue;
        }
        let case = RawCase::from_path(&path).unwrap();
        if case.monkeypatched {
            continue;
        }
        total += 1;
        match check_case(&case) {
            Ok(()) => eprintln!("PASS {name}"),
            Err(e) => {
                eprintln!("FAIL {name}: {e}");
                failures.push(format!("{name}: {e}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{}/{} greedy cases failed:\n{}",
        failures.len(),
        total,
        failures.join("\n")
    );
    eprintln!("{total} greedy cases passed");
}
