//! Temp probe: compare the tessellation of same-named leaves between two CAD
//! files (STEP vs xbf). Prints per-node vertex-delta stats to characterize the
//! drift. Usage:
//!   cargo run --release -p converter --example mesh_diff -- <a> <b> [name-filter]

use converter::graph::AssemblyNode;

fn collect<'a>(n: &'a AssemblyNode, out: &mut Vec<&'a AssemblyNode>) {
    if n.mesh.is_some() {
        out.push(n);
    }
    for c in &n.children {
        collect(c, out);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let filter = args.get(3).cloned();
    let ra = converter::convert::build_tree(&args[1], 0.1, 0.5).expect("a");
    let rb = converter::convert::build_tree(&args[2], 0.1, 0.5).expect("b");
    let (mut la, mut lb) = (Vec::new(), Vec::new());
    collect(&ra, &mut la);
    collect(&rb, &mut lb);
    assert_eq!(la.len(), lb.len(), "leaf count");

    for (a, b) in la.iter().zip(lb.iter()) {
        let (ma, mb) = (a.mesh.as_ref().unwrap(), b.mesh.as_ref().unwrap());
        if ma.geometry_hash == mb.geometry_hash {
            continue;
        }
        if let Some(f) = &filter {
            if !a.name.contains(f.as_str()) {
                continue;
            }
        }
        println!(
            "=== {} verts={} tris={} idx_equal={}",
            a.name,
            ma.positions.len(),
            ma.indices.len(),
            ma.indices == mb.indices
        );
        if ma.positions.len() != mb.positions.len() {
            println!("  VERT COUNT differs: {} vs {}", ma.positions.len(), mb.positions.len());
            continue;
        }
        let mut ndiff = 0usize;
        let mut max_d = 0f64;
        let mut first: Vec<String> = Vec::new();
        for (i, (pa, pb)) in ma.positions.iter().zip(mb.positions.iter()).enumerate() {
            let d = ((pa[0] - pb[0]) as f64).abs().max(((pa[1] - pb[1]) as f64).abs()).max(((pa[2] - pb[2]) as f64).abs());
            if d > 0.0 {
                ndiff += 1;
                if d > max_d {
                    max_d = d;
                }
                if first.len() < 5 {
                    first.push(format!(
                        "    v{}: a=({:.9},{:.9},{:.9}) b=({:.9},{:.9},{:.9}) d={:.3e}",
                        i, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], d
                    ));
                }
            }
        }
        println!(
            "  differing verts: {}/{}  max_delta={:.3e} mm",
            ndiff,
            ma.positions.len(),
            max_d
        );
        for l in first {
            println!("{l}");
        }
        // Classify the index difference: positional triangle compare —
        // identical / same cycle rotated / winding-flipped / different triple;
        // then whole-array set compare (order shuffle vs content change).
        let (mut same, mut rot, mut flip, mut other) = (0usize, 0usize, 0usize, 0usize);
        for (ta, tb) in ma.indices.iter().zip(mb.indices.iter()) {
            let [a0, a1, a2] = *ta;
            let [b0, b1, b2] = *tb;
            if (a0, a1, a2) == (b0, b1, b2) {
                same += 1;
            } else if (a0, a1, a2) == (b1, b2, b0) || (a0, a1, a2) == (b2, b0, b1) {
                rot += 1;
            } else if (a0, a1, a2) == (b0, b2, b1)
                || (a0, a1, a2) == (b2, b1, b0)
                || (a0, a1, a2) == (b1, b0, b2)
            {
                flip += 1;
            } else {
                other += 1;
            }
        }
        println!("  tris positional: same={same} rotated={rot} winding_flipped={flip} different={other}");
        let norm = |idx: &[[u32; 3]], keep_winding: bool| {
            let mut v: Vec<[u32; 3]> = idx
                .iter()
                .map(|t| {
                    if keep_winding {
                        // canonical rotation, winding preserved
                        let [a, b, c] = *t;
                        let m = a.min(b).min(c);
                        if m == a { [a, b, c] } else if m == b { [b, c, a] } else { [c, a, b] }
                    } else {
                        let mut s = *t;
                        s.sort_unstable();
                        s
                    }
                })
                .collect();
            v.sort_unstable();
            v
        };
        println!(
            "  as sets: same_winding_set_equal={} unordered_set_equal={}",
            norm(&ma.indices, true) == norm(&mb.indices, true),
            norm(&ma.indices, false) == norm(&mb.indices, false)
        );
    }
}
