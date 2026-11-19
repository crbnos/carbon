// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! A part the mesher has not finished by the part deadline becomes its
//! bounding box, so one face OCCT cannot mesh never holds up the model. The
//! slow part is a perforated plate on BRepMesh's default path (lean planes
//! off). One test, alone in its file: it flips environment variables.

const HOLES: u32 = 240;

fn proxies(path: &str) -> Vec<bool> {
    let tree = occt_bridge::read_step(path, 0.1, 0.15);
    assert!(tree.ok, "read failed: {}", tree.error);
    tree.nodes
        .iter()
        .filter(|n| n.has_mesh)
        .map(|n| n.is_proxy)
        .collect()
}

#[test]
fn a_part_past_the_mesh_deadline_becomes_its_bounding_box() {
    let dir = std::env::temp_dir().join(format!("carbon-part-deadline-{HOLES}"));
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
    std::env::set_var("ASSEMBLER_LEAN_PLANES", "0");

    assert_eq!(proxies(path), vec![false], "the plate meshes in time");

    std::env::set_var("ASSEMBLER_PART_MESH_SECONDS", "0.01");
    assert_eq!(proxies(path), vec![true], "the deadline did not stop the mesher");
}
