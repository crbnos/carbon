//! Statistical planner benchmark — isolates the PLANNER from OCCT load and
//! process startup, and reports a distribution rather than one noisy wall-clock.
//!
//!   cargo run --profile bench -p planner --example bench_plan -- <in.step> [samples]
//!
//! Loads + tessellates the STEP ONCE, then times only `plan_parts` over N fresh
//! clones (each clone has empty bvh/vol/sym caches — the pristine source is never
//! planned — so every sample is production-representative, not cache-warmed).
//! Reports min / median / mean / stddev; min is the least-noisy "how fast can it
//! go", median the typical. Following std-dev-guide: warm up, take many samples,
//! prefer min/median over a single run.

use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let step = &args[1];
    let samples: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);

    // Load + tessellate once (excluded from the measured region).
    let t_load = Instant::now();
    let root = converter::convert::build_tree(step, 0.1, 0.5).expect("build_tree");
    let parts0 = planner::steps::collect_world_parts(&root); // pristine, never planned
    let load_s = t_load.elapsed().as_secs_f64();
    let tolerance = planner::consts::mesh_tolerance(0.1);

    eprintln!(
        "loaded {} parts in {:.2}s (tessellation, excluded from bench)",
        parts0.len(),
        load_s
    );

    // One warmup (JIT of code paths, allocator warmup) — discarded.
    {
        let mut w = Vec::new();
        let _ = planner::pipeline2::plan_parts(parts0.clone(), 0.5, 60, tolerance, None, &mut w);
    }

    let mut times: Vec<f64> = Vec::with_capacity(samples);
    for _ in 0..samples {
        let parts = parts0.clone(); // fresh empty caches, matches a real request
        let mut warnings = Vec::new();
        let t = Instant::now();
        let out = planner::pipeline2::plan_parts(parts, 0.5, 60, tolerance, None, &mut warnings);
        times.push(t.elapsed().as_secs_f64());
        std::hint::black_box(&out);
    }

    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = times.len();
    let min = times[0];
    let max = times[n - 1];
    let median = times[n / 2];
    let mean = times.iter().sum::<f64>() / n as f64;
    let var = times.iter().map(|t| (t - mean).powi(2)).sum::<f64>() / n as f64;
    let stddev = var.sqrt();

    println!(
        "plan_parts  n={n}  min={min:.3}s  median={median:.3}s  mean={mean:.3}s  max={max:.3}s  stddev={stddev:.3}s  (±{:.1}%)",
        100.0 * stddev / mean
    );
}
