//! Stress/quality harness: plan every STEP file given (files or a directory),
//! score plan QUALITY — the new bar is "minimize manual intervention", i.e.
//! flagged/escape parts — not byte-parity with the Python planner (which the
//! domain owner rates "just ok, required manual intervention on all of them").
//!
//!   cargo run --release -p planner --example stress -- <step-or-dir>... [--json out.json]
//!
//! Per file: tier counts, flagged part names (the manual-work list), verified
//! ratio, plan wall time, determinism (2 runs must hash identical). JSON
//! artifact lets two planner versions be diffed honestly.

use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

fn plan_hash(plan: &Value) -> u64 {
    let mut h = DefaultHasher::new();
    serde_json::to_string(plan).unwrap().hash(&mut h);
    h.finish()
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut json_out = None;
    if let Some(i) = args.iter().position(|a| a == "--json") {
        json_out = args.get(i + 1).cloned();
        args.drain(i..=i.min(args.len() - 2) + 1);
    }
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    for a in &args {
        let p = std::path::PathBuf::from(a);
        if p.is_dir() {
            let mut v: Vec<_> = std::fs::read_dir(&p)
                .unwrap()
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| {
                    p.extension()
                        .map(|e| {
                            let e = e.to_string_lossy().to_lowercase();
                            e == "step" || e == "stp"
                        })
                        .unwrap_or(false)
                })
                .collect();
            v.sort();
            files.extend(v);
        } else {
            files.push(p);
        }
    }

    let mut reports = Vec::new();
    println!(
        "{:<24} {:>5} {:>7} {:>7} {:>6} {:>6} {:>8} {:>7}  det",
        "file", "parts", "linear", "flagged", "escape", "group", "verified", "plan_s"
    );
    for f in &files {
        let name = f.file_stem().unwrap().to_string_lossy().to_string();
        let path = f.to_string_lossy().to_string();
        let t = std::time::Instant::now();
        let r1 =
            match planner::steps::plan_step(&path, 0.1, 0.5, 0.5, 60, Some(5000), None, None, None)
            {
                Ok(r) => r,
                Err(e) => {
                    println!("{name:<24} ERROR: {}", e.message);
                    reports.push(json!({"file": name, "error": e.message}));
                    continue;
                }
            };
        let plan_s = t.elapsed().as_secs_f64();
        let r2 = planner::steps::plan_step(&path, 0.1, 0.5, 0.5, 60, Some(5000), None, None, None)
            .expect("second run");
        let deterministic = plan_hash(&r1.plan) == plan_hash(&r2.plan);

        let tiers: std::collections::BTreeMap<String, i64> =
            r1.tiers.iter().map(|(k, v)| (k.clone(), *v)).collect();
        let g = |k: &str| tiers.get(k).copied().unwrap_or(0);
        // The manual-work list: flagged parts by name (falls back to nodeId).
        let comps = r1.plan["components"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        let flagged: Vec<String> = comps
            .iter()
            .filter(|(_, v)| v["tier"].as_str() == Some("flagged"))
            .map(|(k, v)| {
                v["name"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(k)
                    .to_string()
            })
            .collect();

        println!(
            "{:<24} {:>5} {:>7} {:>7} {:>6} {:>6} {:>7}/{:<3} {:>6.1}s  {}",
            &name[..name.len().min(24)],
            r1.component_count,
            g("linear") + g("l"),
            g("flagged"),
            g("escape"),
            g("group"),
            r1.verified_count,
            r1.planned_count,
            plan_s,
            if deterministic { "ok" } else { "NONDET!" },
        );
        for fp in &flagged {
            println!("{:<24}   flagged: {fp}", "");
        }
        reports.push(json!({
            "file": name,
            "components": r1.component_count,
            "tiers": tiers,
            "flagged_parts": flagged,
            "planned": r1.planned_count,
            "verified": r1.verified_count,
            "plan_seconds": plan_s,
            "deterministic": deterministic,
            "warnings": r1.warnings,
        }));
    }
    if let Some(out) = json_out {
        std::fs::write(&out, serde_json::to_vec_pretty(&json!(reports)).unwrap()).unwrap();
        eprintln!("wrote {out}");
    }
}
