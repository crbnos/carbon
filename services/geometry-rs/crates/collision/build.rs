use std::process::Command;

/// Resolve a library prefix: `<PKG>_PREFIX` env (Docker/Linux) → `brew --prefix`
/// (macOS) → `/opt/homebrew/opt/<pkg>`. `env_key` is e.g. "FCL", "LIBCCD".
fn prefix(pkg: &str, env_key: &str) -> String {
    if let Ok(p) = std::env::var(format!("{env_key}_PREFIX")) {
        if !p.is_empty() {
            return p;
        }
    }
    Command::new("brew")
        .args(["--prefix", pkg])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("/opt/homebrew/opt/{pkg}"))
}

fn main() {
    let use_coal = std::env::var("CARGO_FEATURE_COAL").is_ok();
    let eigen = prefix("eigen", "EIGEN");

    if use_coal {
        // Coal (hpp-fcl successor) backend — same bridge, different narrowphase.
        // C++17 required by coal headers.
        let coal = prefix("coal", "COAL");
        let boost = prefix("boost", "BOOST"); // header-only use (math constants, serialization decls)
        cxx_build::bridge("src/lib.rs")
            .file("src/shim_coal.cc")
            .std("c++17")
            .include(format!("{coal}/include"))
            .include(format!("{eigen}/include/eigen3"))
            .include(format!("{boost}/include"))
            .warnings(false)
            .compile("carbon_fcl_shim");

        println!("cargo:rustc-link-search=native={coal}/lib");
        println!("cargo:rustc-link-search=native={coal}/lib/x86_64-linux-gnu");
        println!("cargo:rustc-link-lib=dylib=coal");
    } else {
        let fcl = prefix("fcl", "FCL");
        let ccd = prefix("libccd", "LIBCCD");
        let octomap = prefix("octomap", "OCTOMAP");

        // Eigen headers live at include/eigen3 (both brew and Debian apt).
        cxx_build::bridge("src/lib.rs")
            .file("src/shim.cc")
            .std("c++14")
            .include(format!("{fcl}/include"))
            .include(format!("{ccd}/include"))
            .include(format!("{eigen}/include/eigen3"))
            .include(format!("{octomap}/include"))
            .warnings(false)
            .compile("carbon_fcl_shim");

        for p in [&fcl, &ccd] {
            println!("cargo:rustc-link-search=native={p}/lib");
            // Debian multiarch.
            println!("cargo:rustc-link-search=native={p}/lib/x86_64-linux-gnu");
        }
        println!("cargo:rustc-link-lib=dylib=fcl");
        println!("cargo:rustc-link-lib=dylib=ccd");
    }

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/shim.cc");
    println!("cargo:rerun-if-changed=src/shim_coal.cc");
    println!("cargo:rerun-if-changed=src/shim.h");
}
