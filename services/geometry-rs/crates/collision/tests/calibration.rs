//! Byte-parity proof: the Rust FCL bridge must reproduce python-fcl's contacts
//! and distances exactly (fixture generated from python-fcl 0.7.0.11 / FCL 0.7.0).

use collision::{collide_pair, distance_pair, new_bvh};
use serde_json::Value;

fn f64s(v: &Value) -> Vec<f64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_f64().unwrap())
        .collect()
}

fn u32s(v: &Value) -> Vec<u32> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_i64().unwrap() as u32)
        .collect()
}

/// Round to 6 dp and pack a contact into a comparable key (absorbs last-ULP
/// noise between the two FCL builds; still far tighter than the 0.15mm planner
/// tolerance).
fn key(depth: f64, n: [f64; 3], p: [f64; 3], b1: i64, b2: i64) -> String {
    let r = |x: f64| (x * 1e6).round() as i64;
    format!(
        "{}|{},{},{}|{},{},{}|{},{}",
        r(depth),
        r(n[0]),
        r(n[1]),
        r(n[2]),
        r(p[0]),
        r(p[1]),
        r(p[2]),
        b1,
        b2
    )
}

#[test]
fn rust_fcl_matches_python_fcl() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/calibration.json");
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();

    for case in data["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let a = new_bvh(&f64s(&case["a"]["verts"]), &u32s(&case["a"]["faces"]));
        let b = new_bvh(&f64s(&case["b"]["verts"]), &u32s(&case["b"]["faces"]));

        if let Some(expected) = case.get("contacts").and_then(|c| c.as_array()) {
            let got = collide_pair(&a, 0.0, 0.0, 0.0, &b, 0.0, 0.0, 0.0, 100_000);
            assert_eq!(
                got.len(),
                expected.len(),
                "[{name}] contact count: rust={} python={}",
                got.len(),
                expected.len()
            );

            let mut got_keys: Vec<String> = got
                .iter()
                .map(|c| {
                    key(
                        c.depth,
                        [c.nx, c.ny, c.nz],
                        [c.px, c.py, c.pz],
                        c.b1 as i64,
                        c.b2 as i64,
                    )
                })
                .collect();
            let mut exp_keys: Vec<String> = expected
                .iter()
                .map(|c| {
                    let a = f64s(c);
                    key(
                        a[0],
                        [a[1], a[2], a[3]],
                        [a[4], a[5], a[6]],
                        a[7] as i64,
                        a[8] as i64,
                    )
                })
                .collect();
            got_keys.sort();
            exp_keys.sort();
            assert_eq!(got_keys, exp_keys, "[{name}] contact multiset mismatch");

            let max_got = got.iter().map(|c| c.depth).fold(f64::MIN, f64::max);
            let max_exp = expected.iter().map(|c| f64s(c)[0]).fold(f64::MIN, f64::max);
            assert!(
                (max_got - max_exp).abs() < 1e-6,
                "[{name}] max depth: rust={max_got} python={max_exp}"
            );
        } else if let Some(expected) = case.get("distance").and_then(|d| d.as_f64()) {
            let got = distance_pair(&a, &b);
            assert!(
                (got - expected).abs() < 1e-6,
                "[{name}] distance: rust={got} python={expected}"
            );
        }
    }
}
