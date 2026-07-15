//! End-to-end smoke: STEP fixture -> plan.json (version 3) via plan_step.

use planner::steps::plan_step;

#[test]
fn plan_step_plates() {
    let dir = match std::env::var("ASSEMBLER_FIXTURES") {
        Ok(d) => d,
        Err(_) => {
            eprintln!("ASSEMBLER_FIXTURES unset; skipping");
            return;
        }
    };
    let step = format!("{dir}/plates.step");
    let result =
        plan_step(&step, 0.1, 0.5, 0.5, 60, Some(5000), None, None, None).expect("plan_step");
    let plan = &result.plan;
    assert_eq!(plan["version"], 3);
    assert_eq!(plan["unit"], "mm");
    assert_eq!(result.component_count, 5);
    let seq = plan["sequence"].as_array().unwrap();
    assert_eq!(seq.len(), 5, "all 5 leaves sequenced");
    let comps = plan["components"].as_object().unwrap();
    assert_eq!(comps.len(), 5);
    // Every sequenced node has a component entry with a motion.
    for id in seq {
        let c = &comps[id.as_str().unwrap()];
        assert!(c.get("motion").is_some(), "component {id} has motion");
    }
    eprintln!(
        "plan_step plates: seq={:?} planned={} verified={} tiers={:?}",
        seq.iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>(),
        result.planned_count,
        result.verified_count,
        result
            .tiers
            .iter()
            .filter(|(_, v)| **v > 0)
            .collect::<Vec<_>>(),
    );
}
