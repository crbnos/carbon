//! Replay the `fixed_sequence` shadow-corpus cases through the Rust planner.

use planner::corpus::RawCase;
use planner::pipeline2::plan_fixed_sequence;
use planner::types::{Component, Motion};
use serde_json::Value;

fn motion_matches(got: &Motion, expected: &Value) -> Result<(), String> {
    let ty = expected.get("type").and_then(|v| v.as_str()).unwrap_or("?");
    let eps = 1e-6;
    match (got, ty) {
        (Motion::None, "none") => Ok(()),
        (Motion::Linear { direction, distance }, "linear") => {
            let ed: Vec<f64> = expected["direction"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
            let edd = expected["distance"].as_f64().unwrap();
            let same = (0..3).all(|i| (direction[i] - ed[i]).abs() <= eps);
            let flipped = (0..3).all(|i| (direction[i] + ed[i]).abs() <= eps);
            if same {
                if (distance - edd).abs() > eps {
                    return Err(format!("linear distance rust={distance} py={edd}"));
                }
                Ok(())
            } else if flipped {
                Ok(())
            } else {
                Err(format!("linear dir rust={direction:?} py={ed:?}"))
            }
        }
        (Motion::L { segments }, "L") => {
            let es = expected["segments"].as_array().unwrap();
            if segments.len() != es.len() {
                return Err(format!("L segs rust={} py={}", segments.len(), es.len()));
            }
            Ok(())
        }
        _ => Err(format!("motion type rust={} py={ty}", got.type_str())),
    }
}

fn check_case(case: &RawCase) -> Result<(), String> {
    let parts: Vec<Component> = case.components.iter().map(Component::from_raw).collect();
    let groups = case.params.groups.clone().unwrap_or_default();
    let mut warnings = Vec::new();
    let outcome = plan_fixed_sequence(
        parts,
        &groups,
        case.params.clearance.unwrap_or(0.5),
        case.params.path_samples.unwrap_or(60),
        case.tolerance(),
        &mut warnings,
    );

    if outcome.sequence != case.result.sequence {
        return Err(format!("sequence\n  rust={:?}\n  py  ={:?}", outcome.sequence, case.result.sequence));
    }
    for k in ["flagged", "group", "escape", "linear", "l"] {
        let gv = *outcome.tiers.get(k).unwrap_or(&0);
        let ev = *case.result.tiers.get(k).unwrap_or(&0);
        if gv != ev {
            return Err(format!("tier[{k}] rust={gv} py={ev}"));
        }
    }
    let by_id: std::collections::HashMap<&str, &planner::types::PlannedComponent> =
        outcome.planned.iter().map(|p| (p.node_id.as_str(), p)).collect();
    for ep in &case.result.planned {
        let gp = by_id.get(ep.node_id.as_str()).ok_or_else(|| format!("missing node {}", ep.node_id))?;
        if gp.tier.as_deref() != ep.tier.as_deref() {
            return Err(format!("[{}] tier rust={:?} py={:?}", ep.node_id, gp.tier, ep.tier));
        }
        if gp.verified != ep.verified {
            return Err(format!("[{}] verified rust={} py={}", ep.node_id, gp.verified, ep.verified));
        }
        if gp.group_id != ep.group_id {
            return Err(format!("[{}] groupId rust={:?} py={:?}", ep.node_id, gp.group_id, ep.group_id));
        }
        motion_matches(&gp.motion, &ep.motion).map_err(|e| format!("[{}] {e}", ep.node_id))?;
    }
    Ok(())
}

#[test]
fn replay_fixed_corpus() {
    let dir = match std::env::var("GEOMETRY_CORPUS") {
        Ok(d) => d,
        Err(_) => {
            eprintln!("GEOMETRY_CORPUS unset; skipping");
            return;
        }
    };
    let mut total = 0;
    let mut failures = Vec::new();
    let mut names: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
    names.sort();
    for path in names {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.contains("fixed_sequence") || !name.ends_with(".json") {
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
    assert!(failures.is_empty(), "{}/{} fixed cases failed:\n{}", failures.len(), total, failures.join("\n\n"));
    eprintln!("{total} fixed_sequence cases passed");
}
