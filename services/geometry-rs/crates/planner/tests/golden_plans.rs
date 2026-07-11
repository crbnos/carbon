//! Golden regression: `plan_step` on the three reference assemblies must
//! reproduce the committed golden plans byte-for-byte. Guards the planner
//! against silent behavior changes on real data (the whole pipeline: tessellate
//! -> classify -> greedy -> precedence -> verify).
//!
//! Skips unless GEOMETRY_ASSEMBLIES points at a directory holding the STEP
//! files (they are large and live outside the repo). Regenerate the goldens
//! with the `plan_file` example after an intended behavior change.

use serde_json::Value;

/// First JSON pointer where two values differ (for a readable failure).
fn first_diff(a: &Value, b: &Value, path: String) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                match (x.get(k), y.get(k)) {
                    (Some(av), Some(bv)) => {
                        if let Some(p) = first_diff(av, bv, format!("{path}/{k}")) {
                            return Some(p);
                        }
                    }
                    _ => return Some(format!("{path}/{k} (present in one side only)")),
                }
            }
            None
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{path} (len {} vs {})", x.len(), y.len()));
            }
            for (i, (av, bv)) in x.iter().zip(y).enumerate() {
                if let Some(p) = first_diff(av, bv, format!("{path}/{i}")) {
                    return Some(p);
                }
            }
            None
        }
        _ => {
            if a == b {
                None
            } else {
                Some(format!("{path}: {a} != {b}"))
            }
        }
    }
}

const CASES: &[(&str, &str)] = &[
    ("SA Seat Rail.step", "seat_rail.plan.json"),
    ("Packing Arm.step", "packing_arm.plan.json"),
    ("SA BCU.step", "bcu.plan.json"),
];

#[test]
fn golden_plans_match() {
    let dir = match std::env::var("GEOMETRY_ASSEMBLIES") {
        Ok(d) => d,
        Err(_) => {
            eprintln!("GEOMETRY_ASSEMBLIES unset; skipping golden regression");
            return;
        }
    };
    let golden_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden");
    let mut failures = Vec::new();
    for (step, golden) in CASES {
        let result = planner::steps::plan_step(
            &format!("{dir}/{step}"),
            0.1,
            0.5,
            0.5,
            60,
            Some(5000),
            None,
            None,
            None,
        )
        .expect("plan_step");
        // Round-trip through a string so the comparison matches the serialized
        // golden exactly (canonical number formatting, no in-memory -0.0/Number
        // representation quirks).
        let got: Value = serde_json::from_str(&serde_json::to_string(&result.plan).unwrap()).unwrap();
        let want: Value =
            serde_json::from_str(&std::fs::read_to_string(format!("{golden_dir}/{golden}")).unwrap())
                .unwrap();
        if got != want {
            if let Some(p) = first_diff(&got, &want, String::new()) {
                failures.push(format!("{step}: differs at {p}"));
            } else {
                failures.push(format!("{step}: differs from {golden}"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn plans_are_deterministic() {
    let dir = match std::env::var("GEOMETRY_ASSEMBLIES") {
        Ok(d) => d,
        Err(_) => return,
    };
    let plan = |step: &str| {
        serde_json::to_value(
            planner::steps::plan_step(
                &format!("{dir}/{step}"),
                0.1,
                0.5,
                0.5,
                60,
                Some(5000),
                None,
                None,
                None,
            )
            .expect("plan_step")
            .plan,
        )
        .unwrap()
    };
    // Packing Arm has the most parallel-sweep fan-out — the likeliest to expose
    // a nondeterministic race if one existed.
    assert_eq!(plan("Packing Arm.step"), plan("Packing Arm.step"));
}
