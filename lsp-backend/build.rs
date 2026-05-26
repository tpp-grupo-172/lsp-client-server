/// Build script — se ejecuta antes de compilar el crate.
/// Verifica que la dependencia Python `jedi` esté disponible
/// e intenta instalarla automáticamente si no lo está.
fn main() {
    // Solo re-ejecutar si build.rs o el analizador Python cambian,
    // evitando correr pip en cada build incremental.
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=jedi_analyzer.py");
    println!("cargo:rerun-if-changed=ts_analyzer.js");

    let has_jedi = std::process::Command::new("python3")
        .args(["-c", "import jedi"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if has_jedi {
        return;
    }

    println!("cargo:warning=jedi no encontrado, instalando...");

    let result = std::process::Command::new("python3")
        .args(["-m", "pip", "install", "--quiet", "jedi"])
        .status();

    match result {
        Ok(s) if s.success() => {
            println!("cargo:warning=jedi instalado correctamente (inferencia de tipos habilitada)");
        }
        Ok(_) => {
            println!(
                "cargo:warning=pip install jedi falló. \
                 Ejecutá `pip install jedi` manualmente para habilitar la inferencia avanzada de tipos."
            );
        }
        Err(e) => {
            println!(
                "cargo:warning=python3 no encontrado ({}). \
                 La inferencia de tipos avanzada estará deshabilitada.",
                e
            );
        }
    }
}
