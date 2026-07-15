//! Concurrency correctness + scaling probe for the full convert path. Each of N
//! threads runs convert_step in a loop and hashes the ENTIRE output (glb bytes +
//! graph json). If concurrent reads corrupt anything — e.g. the OCCT 7.9.3
//! shared-Bigint strtod race that mis-parses floats under load — the hash set
//! grows beyond one. One distinct hash across all threads == bit-for-bit
//! deterministic under concurrency. Also reports throughput scaling.
//!
//!   cargo run --release -p converter --example conc_convert -- <file.step> [iters]

use sha1::{Digest, Sha1};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Instant;

fn hash_output(step_path: &str, text: &str) -> String {
    let c = converter::convert::convert_step(step_path, text, 0.1, 0.5).expect("convert failed");
    let mut h = Sha1::new();
    h.update(&c.glb);
    h.update(serde_json::to_vec(&c.graph).unwrap());
    format!("{:x}", h.finalize())
}

fn run(path: &Arc<String>, text: &Arc<String>, threads: usize, iters: usize) -> (f64, HashSet<String>) {
    let hashes = Arc::new(Mutex::new(HashSet::new()));
    let start = Instant::now();
    let mut handles = Vec::new();
    for _ in 0..threads {
        let (p, t, hs) = (Arc::clone(path), Arc::clone(text), Arc::clone(&hashes));
        handles.push(std::thread::spawn(move || {
            for _ in 0..iters {
                let hash = hash_output(p.as_str(), t.as_str());
                hs.lock().unwrap().insert(hash);
            }
        }));
    }
    for h in handles {
        h.join().expect("thread panicked");
    }
    let secs = start.elapsed().as_secs_f64();
    let rps = (threads * iters) as f64 / secs;
    let set = Arc::try_unwrap(hashes).unwrap().into_inner().unwrap();
    (rps, set)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = Arc::new(args.get(1).cloned().expect("usage: conc_convert <file.step> [iters]"));
    let iters: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(20);
    let text = Arc::new(std::fs::read_to_string(path.as_str()).expect("read step"));
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);

    // Establish the golden hash single-threaded.
    let golden = hash_output(path.as_str(), text.as_str());
    println!("golden (T=1, serial): {golden}");

    let (rps1, _) = run(&path, &text, 1, iters);
    println!("T= 1: {rps1:7.2} conv/s  (baseline)");

    let sweep: Vec<usize> = std::env::var("SWEEP")
        .ok()
        .map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
        .unwrap_or_else(|| vec![2, 4, cores]);
    for &t in &sweep {
        let (rps, set) = run(&path, &text, t, iters);
        let scale = rps / rps1;
        let clean = set.len() == 1 && set.contains(&golden);
        println!(
            "T={t:2}: {rps:7.2} conv/s  {scale:4.2}x   {} ({} distinct hash{})",
            if clean { "CORRECT" } else { "!! CORRUPTION !!" },
            set.len(),
            if set.len() == 1 { "" } else { "es" },
        );
    }
}
