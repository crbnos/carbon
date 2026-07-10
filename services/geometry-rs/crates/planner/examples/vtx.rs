use converter::graph::AssemblyNode;
fn find<'a>(n: &'a AssemblyNode, t: &str) -> Option<&'a AssemblyNode> {
    if n.node_id.starts_with(t) && n.mesh.is_some() { return Some(n); }
    for c in &n.children { if let Some(r) = find(c, t) { return Some(r); } }
    None
}
fn main() {
    let root = converter::convert::build_tree("/Users/sidwebworks/Downloads/SA Seat Rail.step", 0.1, 0.5).unwrap();
    let n = find(&root, "95b0b86e").unwrap();
    let p = n.mesh.as_ref().unwrap().positions[100];
    println!("rs raw f32 [100]: {:?} bits: {}", p, p.iter().map(|x| hex::encode(x.to_le_bytes())).collect::<Vec<_>>().join(" "));
}
