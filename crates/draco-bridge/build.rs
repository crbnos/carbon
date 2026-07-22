/// Resolve the draco install prefix: `DRACO_PREFIX` env when set, else the
/// per-target default (Homebrew `opt` on macOS, distro `/usr` on Linux). The
/// Dockerfile builds static draco and sets `DRACO_PREFIX` explicitly.
fn prefix() -> String {
    if let Ok(p) = std::env::var("DRACO_PREFIX") {
        if !p.is_empty() {
            return p;
        }
    }
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    match os.as_str() {
        "macos" if arch == "aarch64" => "/opt/homebrew/opt/draco".to_string(),
        "macos" => "/usr/local/opt/draco".to_string(),
        _ => "/usr".to_string(),
    }
}

fn main() {
    let draco = prefix();

    let mut build = cxx_build::bridge("src/lib.rs");
    build
        .file("src/shim.cc")
        .std("c++17")
        .include(format!("{draco}/include"))
        .warnings(false);
    build.compile("carbon_draco_shim");

    println!("cargo:rustc-link-search=native={draco}/lib");
    println!("cargo:rustc-link-search=native={draco}/lib/x86_64-linux-gnu");
    // Static libdraco.a when the prefix ships one (deployment build → a
    // self-contained binary with no draco runtime .so); else dynamic (brew dev).
    let static_archive = ["lib", "lib/x86_64-linux-gnu"]
        .iter()
        .any(|sub| std::path::Path::new(&format!("{draco}/{sub}/libdraco.a")).exists());
    let kind = if static_archive { "static" } else { "dylib" };
    println!("cargo:rustc-link-lib={kind}=draco");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/shim.cc");
    println!("cargo:rerun-if-changed=src/shim.h");
    println!("cargo:rerun-if-env-changed=DRACO_PREFIX");
}
