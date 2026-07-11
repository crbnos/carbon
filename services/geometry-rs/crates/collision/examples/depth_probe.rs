//! Backend depth calibration: two 10mm cubes overlapping by exactly 0.5mm along
//! X, plus a separated pair. Prints contact count, max depth, and distance so
//! the coal backend's sign/magnitude conventions are verified EMPIRICALLY
//! against the FCL backend (run once per backend and compare):
//!   cargo run --release -p collision --example depth_probe
//!   cargo run --release -p collision --example depth_probe --features coal
//! Expected (FCL fixture): overlap → max depth ≈ +0.5; separated(3mm) → dist 3.0.

use collision::{collide_pair, distance_pair, new_bvh};

fn cube(cx: f64, cy: f64, cz: f64, half: f64) -> (Vec<f64>, Vec<u32>) {
    let (x0, x1) = (cx - half, cx + half);
    let (y0, y1) = (cy - half, cy + half);
    let (z0, z1) = (cz - half, cz + half);
    let v = vec![
        x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, // back
        x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, // front
    ];
    let f: Vec<u32> = vec![
        0, 2, 1, 0, 3, 2, // -z
        4, 5, 6, 4, 6, 7, // +z
        0, 1, 5, 0, 5, 4, // -y
        2, 3, 7, 2, 7, 6, // +y
        1, 2, 6, 1, 6, 5, // +x
        0, 4, 7, 0, 7, 3, // -x
    ];
    (v, f)
}

fn main() {
    let (av, af) = cube(0.0, 0.0, 0.0, 5.0);
    let a = new_bvh(&av, &af);

    // Overlap 0.5mm: second cube center at 9.5 (faces at 4.5..14.5 vs -5..5).
    let (bv, bf) = cube(9.5, 0.0, 0.0, 5.0);
    let b = new_bvh(&bv, &bf);
    let contacts = collide_pair(&a, 0.0, 0.0, 0.0, &b, 0.0, 0.0, 0.0, 100_000);
    let max_depth = contacts.iter().map(|c| c.depth).fold(f64::NEG_INFINITY, f64::max);
    let min_depth = contacts.iter().map(|c| c.depth).fold(f64::INFINITY, f64::min);
    println!(
        "overlap0.5: contacts={} max_depth={:.6} min_depth={:.6}",
        contacts.len(),
        max_depth,
        min_depth
    );

    // Separated by 3mm: center at 13 (faces at 8..18 vs -5..5).
    let (cv, cf) = cube(13.0, 0.0, 0.0, 5.0);
    let c = new_bvh(&cv, &cf);
    let sep = collide_pair(&a, 0.0, 0.0, 0.0, &c, 0.0, 0.0, 0.0, 100_000);
    println!("separated3: contacts={} distance={:.6}", sep.len(), distance_pair(&a, &c));

    // Deep overlap 5mm: center at 5 (faces 0..10 vs -5..5).
    let (dv, df) = cube(5.0, 0.0, 0.0, 5.0);
    let d = new_bvh(&dv, &df);
    let deep = collide_pair(&a, 0.0, 0.0, 0.0, &d, 0.0, 0.0, 0.0, 100_000);
    let max_deep = deep.iter().map(|c| c.depth).fold(f64::NEG_INFINITY, f64::max);
    println!("overlap5.0: contacts={} max_depth={:.6}", deep.len(), max_deep);
}
