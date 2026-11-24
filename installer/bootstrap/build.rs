fn main() {
    println!("cargo:rerun-if-changed=../../src-tauri/icons/icon.ico");
    #[cfg(windows)]
    {
        winres::WindowsResource::new()
            .set_icon("../../src-tauri/icons/icon.ico")
            .set("ProductName", "TurtleClient Setup")
            .set("FileDescription", "TurtleClient Bootstrap Installer")
            .set("CompanyName", "TurtleClient")
            .set("LegalCopyright", "Copyright 2026 TurtleClient contributors")
            .compile()
            .expect("Turtle installer Windows resources");
    }
}
