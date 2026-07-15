//! Isolated concurrency probe for `read_step`. Does OCCT 7.9.3 STEP reading
//! actually parallelize across threads, or serialize / crash on shared global
//! state? Bypasses the HTTP path entirely: N OS threads each call read_step in a
//! tight loop, measured at T=1 then T=THREADS. Linear scaling => parallel; flat
//! throughput => serialized; SIGABRT/SIGSEGV => 7.9.3 concurrency bug.
//!
//!   cargo run --release -p occt-bridge --example conc_read -- <file.step> [iters]

use std::sync::Arc;
use std::time::Instant;

fn run(path: &Arc<String>, threads: usize, iters: usize) -> (f64, u64) {
    let start = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..threads {
        let p = Arc::clone(path);
        handles.push(std::thread::spawn(move || {
            let mut nodes = 0u64;
            for _ in 0..iters {
                let t = occt_bridge::read_step(p.as_str(), 0.1, 0.5);
                assert!(t.ok, "read failed: {}", t.error);
                nodes += t.nodes.len() as u64;
            }
            nodes
        }));
    }
    let mut total = 0u64;
    for h in handles {
        total += h.join().expect("thread panicked");
    }
    let secs = start.elapsed().as_secs_f64();
    let reads = (threads * iters) as f64;
    (reads / secs, total)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = Arc::new(args.get(1).cloned().expect("usage: conc_read <file.step> [iters]"));
    let iters: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(100);
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);

    // Warm globals single-threaded (mirrors the call_once init path).
    let _ = occt_bridge::read_step(path.as_str(), 0.1, 0.5);

    let (rps1, _) = run(&path, 1, iters);
    println!("T= 1: {rps1:8.1} reads/s  (baseline)");

    for &t in &[2usize, 4, cores] {
        let (rps, _) = run(&path, t, iters);
        let scale = rps / rps1;
        let verdict = if scale > t as f64 * 0.7 {
            "PARALLEL"
        } else if scale < 1.4 {
            "SERIALIZED"
        } else {
            "partial"
        };
        println!("T={t:2}: {rps:8.1} reads/s  {scale:4.2}x  [{verdict}]");
    }
}
