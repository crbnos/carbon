//! Debug a single corpus case: prints classification + pipeline intermediates.
//! Usage: GEOMETRY_CORPUS=/tmp/geom-corpus cargo run -p planner --example debug_case -- 0013

use planner::corpus::RawCase;
use planner::fasteners::is_fastener;
use planner::geom::symmetry_axis_kind;
use planner::pipeline::{classify_fasteners, seated_pair_depths};
use planner::types::Component;

fn main() {
    let dir = std::env::var("GEOMETRY_CORPUS").unwrap();
    let arg = std::env::args().nth(1).unwrap();
    let path = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.file_name().unwrap().to_string_lossy().starts_with(&arg))
        .unwrap();
    let case = RawCase::from_path(&path).unwrap();
    let parts: Vec<Component> = case.components.iter().map(Component::from_raw).collect();

    for p in &parts {
        println!(
            "{:12} fastener_name={} sym_axis={:?} bbox=({:.1},{:.1},{:.1})",
            p.name,
            is_fastener(p),
            symmetry_axis_kind(p).map(|(a, k)| format!("{:?} [{:.2},{:.2},{:.2}]", k, a[0], a[1], a[2])),
            p.bbox_max[0] - p.bbox_min[0],
            p.bbox_max[1] - p.bbox_min[1],
            p.bbox_max[2] - p.bbox_min[2],
        );
    }
    let pd = seated_pair_depths(&parts);
    println!("\npairs:");
    let mut keys: Vec<_> = pd.keys().collect();
    keys.sort();
    for k in keys {
        let d = &pd[k];
        println!("  {}-{} depth={:.3} npts={}", d.a, d.b, d.depth, d.points.len());
    }
    let f = classify_fasteners(&parts, &pd);
    println!("\nclassified fasteners: {:?}", {
        let mut v: Vec<_> = f.iter().map(|(k, i)| format!("{}={:?} mates={:?}", k, i.kind, i.mates.keys().collect::<Vec<_>>())).collect();
        v.sort();
        v
    });

    let joints = planner::pipeline::fastener_joints(&parts, &f);
    println!("joints: {joints:?}");

    // Trace greedy directly.
    {
        use std::collections::{HashMap, HashSet};
        let mut gu = HashMap::new();
        let mut lm = HashMap::new();
        let mut w = Vec::new();
        let empty: HashSet<String> = HashSet::new();
        let (ro, seq, tiers) = planner::greedy::greedy_disassembly(
            &parts, 0.5, case.params.path_samples.unwrap_or(60), case.tolerance(),
            &f, &empty, &empty, None, &mut gu, &mut lm, &mut w,
        );
        println!("greedy removal_order: {:?}", ro.iter().map(|e| format!("{}:{:?}", e.node_id, e.tier)).collect::<Vec<_>>());
        println!("greedy sequence: {seq:?} tiers={:?}", tiers.iter().filter(|(_,v)| **v>0).collect::<Vec<_>>());
    }

    // Direct plan_removal probe: fastener vs each other single part.
    {
        use planner::geom::{exit_travel, separation_distance};
        use planner::collide::{path_is_clear, self_exempt, mate_exempt};
        for fid in f.keys() {
            let part = parts.iter().find(|p| &p.node_id == fid).unwrap();
            let info = &f[fid];
            let head = planner::fasteners::head_direction(part, info, None);
            println!("probe {fid}: axis=[{:.2},{:.2},{:.2}] head=[{:.2},{:.2},{:.2}] sliding={:?}", info.axis[0],info.axis[1],info.axis[2], head[0],head[1],head[2], info.sliding.keys().collect::<Vec<_>>());
            for other in &parts {
                if &other.node_id == fid { continue; }
                let os = [other];
                let ow = planner::collide::CollisionWorld::new(&os);
                let (smin, smax) = (other.bbox_min, other.bbox_max);
                for dir in [head, -head] {
                    let tv = exit_travel(part, &smin, &smax, &dir, None);
                    let sep = separation_distance(&part.bbox_min, &part.bbox_max, &smin, &smax, &dir);
                    let ex = self_exempt(mate_exempt(part, &dir, &f), &[fid]);
                    let lt = path_is_clear(part, &ow, &dir, 0.0, tv, case.params.path_samples.unwrap_or(60), case.tolerance(), None, Some(ex), Some(sep+4.0));
                    println!("   vs {} dir[{:.1},{:.1},{:.1}] travel={:.1} clear={:?}", other.node_id, dir[0],dir[1],dir[2], tv, lt);
                }
            }
        }
    }

    let mut warnings = Vec::new();
    let outcome = planner::pipeline2::plan_parts(
        parts.clone(),
        case.params.clearance.unwrap_or(0.5),
        case.params.path_samples.unwrap_or(60),
        case.tolerance(),
        None,
        &mut warnings,
    );
    println!("\nrust sequence: {:?}", outcome.sequence);
    println!("py   sequence: {:?}", case.result.sequence);
    for e in &outcome.planned {
        println!("  {:10} tier={:?} verified={} motion={}", e.node_id, e.tier, e.verified, e.motion.type_str());
    }
    println!("edges:");
    let mut ek: Vec<_> = outcome.edges.iter().filter(|(_, v)| !v.is_empty()).collect();
    ek.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in ek {
        let mut vs: Vec<_> = v.iter().collect();
        vs.sort();
        println!("  {k} -> {vs:?}");
    }
    println!("warnings: {warnings:?}");
}
