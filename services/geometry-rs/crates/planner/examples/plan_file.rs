//! Plan a STEP file and write plan.json. Usage:
//!   cargo run --release -p planner --example plan_file -- <in.step> <out.plan.json>

// jemalloc on Linux only: measured on macOS it LOSES to the system allocator
// (~+6% wall on all three real assemblies); glibc malloc under rayon-threaded
// allocation churn is the case it wins. Matches the server binary's gating.
#[cfg(target_os = "linux")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let step = &args[1];
    let out = &args[2];
    let t = std::time::Instant::now();
    let r = planner::steps::plan_step(step, 0.1, 0.5, 0.5, 60, Some(5000), None, None, None)
        .expect("plan");
    std::fs::write(out, serde_json::to_vec(&r.plan).unwrap()).unwrap();
    eprintln!(
        "comps={} planned={} verified={} {:.1}s tiers={:?} contacts_at_calls={} narrow_pairs={} raw_contacts={}",
        r.component_count,
        r.planned_count,
        r.verified_count,
        t.elapsed().as_secs_f64(),
        r.tiers.iter().filter(|(_, v)| **v > 0).collect::<Vec<_>>(),
        planner::collide::contacts_at_calls(),
        collision::narrow_pairs_run(),
        collision::raw_contacts_enumerated(),
    );
}
