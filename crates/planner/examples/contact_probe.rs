//! Diagnostic: measure the min mesh distance between contact-graph components,
//! to size ORDERING_CONTACT_MM. Usage:
//!   cargo run --release -p planner --example contact_probe -- <in.step> [contact_mm]

use converter::convert::build_tree;
use planner::pipeline::{ordering_adjacency, PairDepths};
use planner::steps::collect_world_parts;
use std::collections::{HashMap, HashSet, VecDeque};

fn components(adj: &HashMap<String, HashSet<String>>) -> Vec<Vec<String>> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut comps = Vec::new();
    for start in adj.keys() {
        if seen.contains(start) {
            continue;
        }
        let mut q = VecDeque::from([start.clone()]);
        let mut comp = Vec::new();
        seen.insert(start.clone());
        while let Some(n) = q.pop_front() {
            comp.push(n.clone());
            for nb in adj.get(&n).into_iter().flatten() {
                if seen.insert(nb.clone()) {
                    q.push_back(nb.clone());
                }
            }
        }
        comps.push(comp);
    }
    comps
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let step = &args[1];
    let probe_mm: f64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.5);

    let root = build_tree(step, 0.1, 0.5).expect("build");
    let parts = collect_world_parts(&root);
    let idx: HashMap<String, usize> =
        parts.iter().enumerate().map(|(i, p)| (p.node_id.clone(), i)).collect();
    let name = |id: &str| -> String {
        parts[*idx.get(id).unwrap()].name.clone()
    };

    // Baseline adjacency at the given threshold → components.
    let pair_depths: PairDepths = HashMap::new();
    let adj = ordering_adjacency(&parts, &pair_depths, probe_mm);
    let mut comps = components(&adj);
    comps.sort_by_key(|c| std::cmp::Reverse(c.len()));
    let edges: usize = adj.values().map(|s| s.len()).sum::<usize>() / 2;
    let n = parts.len();
    let max_edges = n * (n - 1) / 2;
    eprintln!(
        "parts={} contact_mm={} components={} sizes={:?} edges={}/{} (avg_deg={:.1})",
        n,
        probe_mm,
        comps.len(),
        comps.iter().map(|c| c.len()).collect::<Vec<_>>(),
        edges,
        max_edges,
        2.0 * edges as f64 / n as f64
    );

    // For every pair of DIFFERENT components, the closest mesh distance.
    let comp_of: HashMap<String, usize> = comps
        .iter()
        .enumerate()
        .flat_map(|(ci, c)| c.iter().map(move |id| (id.clone(), ci)))
        .collect();

    let n = parts.len();
    let mut best_between: HashMap<(usize, usize), (f64, String, String)> = HashMap::new();
    for i in 0..n {
        for j in (i + 1)..n {
            let ci = comp_of[&parts[i].node_id];
            let cj = comp_of[&parts[j].node_id];
            if ci == cj {
                continue;
            }
            let key = (ci.min(cj), ci.max(cj));
            // bbox prefilter to keep it cheap: only measure pairs within 20mm bbox
            let within = (0..3).all(|k| {
                parts[i].bbox_min[k] - 20.0 <= parts[j].bbox_max[k]
                    && parts[j].bbox_min[k] - 20.0 <= parts[i].bbox_max[k]
            });
            if !within {
                continue;
            }
            let d = collision::distance_pair(&parts[i].bvh(), &parts[j].bvh());
            let e = best_between
                .entry(key)
                .or_insert((f64::INFINITY, String::new(), String::new()));
            if d < e.0 {
                *e = (d, name(&parts[i].node_id), name(&parts[j].node_id));
            }
        }
    }
    let mut rows: Vec<_> = best_between.into_iter().collect();
    rows.sort_by(|a, b| a.1 .0.partial_cmp(&b.1 .0).unwrap());
    eprintln!("closest inter-component mesh distances (bbox<20mm pairs):");
    for ((ci, cj), (d, a, b)) in rows.iter().take(20) {
        eprintln!(
            "  comp{ci}(n={}) <-> comp{cj}(n={}) : {d:.3} mm  [{a} <-> {b}]",
            comps[*ci].len(),
            comps[*cj].len()
        );
    }
}
