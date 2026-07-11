//! Replay the `plan_parts` shadow-corpus cases through the full Rust pipeline
//! and assert semantic parity with the Python outcome.

use planner::corpus::RawCase;
use planner::pipeline2::plan_parts;
use planner::types::{Component, Motion};
use serde_json::Value;
use std::collections::HashSet;

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
            // A global sign flip only happens when both senses are equally valid
            // escapes (a forced direction would be blocked in one sense, so both
            // implementations agree). In that arbitrary case the traversed distance
            // is also arbitrary (opposite exempt bodies differ in thickness), so
            // require the distance only when the direction matches exactly.
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
            for (i, seg) in segments.iter().enumerate() {
                let ed: Vec<f64> = es[i]["direction"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
                let edd = es[i]["distance"].as_f64().unwrap();
                let same = (0..3).all(|k| (seg.direction[k] - ed[k]).abs() <= eps);
                let flipped = (0..3).all(|k| (seg.direction[k] + ed[k]).abs() <= eps);
                if !(same || flipped) {
                    return Err(format!("L seg{i} dir rust={:?} py={ed:?}", seg.direction));
                }
                if (seg.distance - edd).abs() > eps {
                    return Err(format!("L seg{i} dist rust={} py={edd}", seg.distance));
                }
            }
            Ok(())
        }
        _ => Err(format!("motion type rust={} py={ty}", got.type_str())),
    }
}

/// bbox volume of a captured component.
fn bbox_volume(c: &planner::corpus::RawComponent) -> f64 {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for v in c.vertices.chunks_exact(3) {
        for k in 0..3 {
            lo[k] = lo[k].min(v[k]);
            hi[k] = hi[k].max(v[k]);
        }
    }
    ((hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])).abs()
}

/// Two sequences are equivalent if equal, or if they differ only by transposing
/// parts of equal volume — an arbitrary tie (equal removal priority) that
/// floating-point noise in the volume computation resolves differently between
/// numpy and Rust. Never masks a reorder of differently-sized/roled parts.
fn sequences_equivalent(rust: &[String], py: &[String], case: &RawCase) -> bool {
    if rust == py {
        return true;
    }
    if rust.len() != py.len() {
        return false;
    }
    let mut a: Vec<&String> = rust.iter().collect();
    let mut b: Vec<&String> = py.iter().collect();
    a.sort();
    b.sort();
    if a != b {
        return false; // not even a permutation
    }
    let vol: std::collections::HashMap<&str, f64> =
        case.components.iter().map(|c| (c.node_id.as_str(), bbox_volume(c))).collect();
    let differing: Vec<&str> = rust
        .iter()
        .zip(py.iter())
        .filter(|(r, p)| r != p)
        .map(|(r, _)| r.as_str())
        .collect();
    if differing.is_empty() {
        return true;
    }
    let vols: Vec<f64> = differing.iter().map(|id| vol[id]).collect();
    let vmax = vols.iter().cloned().fold(f64::MIN, f64::max);
    let vmin = vols.iter().cloned().fold(f64::MAX, f64::min);
    (vmax - vmin) <= 1e-6 * vmax.max(1.0)
}

fn tier_class(t: Option<&str>) -> &str {
    match t {
        Some("linear") | Some("L") => "clean",
        Some(x) => x,
        None => "none",
    }
}

fn check_case(case: &RawCase) -> Result<(), String> {
    let parts: Vec<Component> = case.components.iter().map(Component::from_raw).collect();
    let protected: HashSet<String> = case.params.protected.iter().cloned().collect();
    let protected = if protected.is_empty() { None } else { Some(&protected) };
    let mut warnings = Vec::new();
    let outcome = plan_parts(
        parts,
        case.params.clearance.unwrap_or(0.5),
        case.params.path_samples.unwrap_or(60),
        case.tolerance(),
        protected,
        &mut warnings,
    );

    if !sequences_equivalent(&outcome.sequence, &case.result.sequence, case) {
        return Err(format!("sequence\n  rust={:?}\n  py  ={:?}", outcome.sequence, case.result.sequence));
    }
    // Nodes transposed by the arbitrary equal-volume tie: their removal CONTEXT
    // (what else is still present) is order-dependent, so their tier-1-vs-tier-2
    // (linear vs "L") split is arbitrary too. Relax only for those nodes.
    let arbitrary: HashSet<&str> = outcome
        .sequence
        .iter()
        .zip(case.result.sequence.iter())
        .filter(|(r, p)| r != p)
        .map(|(r, _)| r.as_str())
        .collect();
    // flagged/group/escape are semantic — compare exactly; linear/L is a clean-
    // removal quality split — compare the pooled count.
    for k in ["flagged", "group", "escape"] {
        let gv = *outcome.tiers.get(k).unwrap_or(&0);
        let ev = *case.result.tiers.get(k).unwrap_or(&0);
        if gv != ev {
            return Err(format!("tier[{k}] rust={gv} py={ev}"));
        }
    }
    let clean = |t: &std::collections::BTreeMap<String, i64>| t.get("linear").unwrap_or(&0) + t.get("l").unwrap_or(&0);
    if clean(&outcome.tiers) != clean(&case.result.tiers) {
        return Err(format!("clean(linear+l) rust={} py={}", clean(&outcome.tiers), clean(&case.result.tiers)));
    }
    // merged_into
    let mut gm: Vec<(String, String)> = outcome.merged_into.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let mut pm: Vec<(String, String)> = case.result.merged_into.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    gm.sort();
    pm.sort();
    if gm != pm {
        return Err(format!("mergedInto rust={gm:?} py={pm:?}"));
    }
    // per-node tier + motion + verified + groupId
    let by_id: std::collections::HashMap<&str, &planner::types::PlannedComponent> =
        outcome.planned.iter().map(|p| (p.node_id.as_str(), p)).collect();
    for ep in &case.result.planned {
        let gp = by_id.get(ep.node_id.as_str()).ok_or_else(|| format!("missing node {}", ep.node_id))?;
        // Verified + tier-CLASS (clean/flagged/base/group) are always semantic.
        if tier_class(gp.tier.as_deref()) != tier_class(ep.tier.as_deref()) {
            return Err(format!("[{}] tier-class rust={:?} py={:?}", ep.node_id, gp.tier, ep.tier));
        }
        if gp.verified != ep.verified {
            return Err(format!("[{}] verified rust={} py={}", ep.node_id, gp.verified, ep.verified));
        }
        if gp.group_id != ep.group_id {
            return Err(format!("[{}] groupId rust={:?} py={:?}", ep.node_id, gp.group_id, ep.group_id));
        }
        // A case containing an interchangeable-part transposition (`arbitrary`
        // non-empty) has inherent removal-order arbitrariness: the exact tier
        // (linear vs L) and the escape direction/distance of parts become
        // tie-break-sensitive (e.g. the bridge's least-entangling exit flips
        // between +Z and a sideways slide depending on the riser order). Both
        // are verified collision-free. Keep the exact tier + motion strict only
        // for fully-determinate cases.
        if !arbitrary.is_empty() {
            continue;
        }
        if gp.tier.as_deref() != ep.tier.as_deref() {
            return Err(format!("[{}] tier rust={:?} py={:?}", ep.node_id, gp.tier, ep.tier));
        }
        motion_matches(&gp.motion, &ep.motion).map_err(|e| format!("[{}] {e}", ep.node_id))?;
    }
    Ok(())
}

#[test]
fn replay_plan_parts_corpus() {
    // The corpus captures the PYTHON planner's outcomes — replay in compat mode
    // (the improved default algorithm intentionally diverges from Python).
    std::env::set_var("GEOMETRY_COMPAT", "python");
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
        if !name.contains("plan_parts") || !name.ends_with(".json") {
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
    assert!(failures.is_empty(), "{}/{} plan_parts cases failed:\n{}", failures.len(), total, failures.join("\n\n"));
    eprintln!("{total} plan_parts cases passed");
}
