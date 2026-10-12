// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! A plate with many holes is meshed without BRepMesh's interior-node pass on
//! its flat faces. That must leave the graph (nodeIds, geometry hashes) and the
//! triangle count as they were, and it must be what keeps the memory down. The
//! triangle wiring is not compared: on a regular hole pattern the two paths can
//! break a co-circular tie differently. One test, alone in its file: it flips
//! an environment variable and reads the process's peak memory.

use converter::convert::convert_step;

const HOLES: u32 = 240;

fn peak_rss_bytes() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: getrusage fills the struct it is given.
    let usage = unsafe {
        assert_eq!(libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()), 0);
        usage.assume_init()
    };
    // macOS reports bytes, Linux kilobytes.
    let scale = if cfg!(target_os = "macos") { 1 } else { 1024 };
    usage.ru_maxrss as u64 * scale
}

fn convert(path: &str) -> (String, usize) {
    let text = std::fs::read_to_string(path).unwrap();
    let converted = convert_step(path, &text, 0.1, 0.15).expect("convert");
    let graph = serde_json::to_string(&converted.graph).unwrap();
    (graph, converted.triangles as usize)
}

#[test]
fn a_perforated_plate_keeps_its_graph_in_far_less_memory() {
    let dir = std::env::temp_dir().join(format!("carbon-lean-planes-{HOLES}"));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("plate.step");
    let path = path.to_str().unwrap();
    assert!(occt_bridge::write_test_plate_with_holes(
        path,
        6.0 * HOLES as f64,
        10.0,
        2.0,
        HOLES
    ));

    // Lean first: peak memory only ever rises, so the default path must run last.
    let before = peak_rss_bytes();
    let lean = convert(path);
    let after_lean = peak_rss_bytes();
    std::env::set_var("ASSEMBLER_LEAN_PLANES", "0");
    let default = convert(path);
    let after_default = peak_rss_bytes();

    assert!(lean.1 > HOLES as usize * 100, "the holes were not meshed");
    assert_eq!(lean, default, "the lean path changed the plate's graph");
    assert!(
        after_default as f64 > after_lean as f64 * 1.5,
        "the default path should need far more memory than the lean one \
         (start {before}, lean {after_lean}, default {after_default} bytes)"
    );
}
