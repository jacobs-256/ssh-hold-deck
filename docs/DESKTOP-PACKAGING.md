# Desktop Packaging

The former Node packaging proposal is retired and retained in Git history.
Current documentation:

- [Desktop builds and verification](DESKTOP.md)
- [Rust architecture](ARCHITECTURE.md)
- [Migration and service operations](MIGRATION.md)

No Node runtime or backend JavaScript is shipped. macOS uses the Tauri executable
in backend mode; Windows bundles the Linux Rust backend for WSL.
