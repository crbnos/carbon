//! Pose-matched contact probe: query one part at an exact translation against
//! all others, print every reported (neighbor, depth). Run under both backends
//! to compare depth semantics pairwise.
//!   probe_pose <step> <nodeId> <tx> <ty> <tz>

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let root = converter::convert::build_tree(&a[1], 0.1, 0.5).expect("build_tree");
    let parts = planner::steps::collect_world_parts(&root);
    let t = nalgebra::Vector3::new(
        a[3].parse::<f64>().unwrap(),
        a[4].parse::<f64>().unwrap(),
        a[5].parse::<f64>().unwrap(),
    );
    let part = parts.iter().find(|p| p.node_id == a[2]).expect("part");
    let world = planner::collide::CollisionWorld::from_components(&parts);
    // Raw full-enumeration query (contacts_at) — no classify thresholds.
    let full = world.contacts_at(part, &t);
    println!("contacts_at   : {:?}", full.iter().map(|(n, d)| (&n[..8], *d)).collect::<Vec<_>>());
    // Classified query at tol=0.25, no exempts.
    let no_skip = std::collections::BTreeSet::new();
    let ov = (Vec::new(), Vec::new());
    let cls = world.classify(part, &t, &no_skip, &ov, 0.25, true);
    println!("classify(.25) : {:?}", cls.iter().map(|(n, d)| (&n[..8], *d)).collect::<Vec<_>>());

    // Optional 7th arg: otherId — exact separation distance of the pair at this
    // pose (moving part baked to the translated position), to test the tangent-
    // contact hypothesis (distance ≈ 0 ⇒ touching, not crossing).
    if let Some(other_id) = a.get(6) {
        let other = parts.iter().find(|p| p.node_id == *other_id).expect("other");
        let mut moved = part.mesh.clone();
        for v in &mut moved.vertices {
            *v += t;
        }
        let mv = moved.flat_vertices();
        let mf = moved.flat_faces();
        let moved_bvh = collision::new_bvh(&mv, &mf);
        let d = collision::distance_pair(&moved_bvh, &other.bvh());
        println!("distance({} vs {}) at pose = {d:.6}", &a[2][..8], &other_id[..8]);
    }
}
