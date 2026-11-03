# Compatibility Oracles

These modules preserve the previous JavaScript algorithms for development tests
of old credential and backup formats, and legacy JavaScript regression tests.
They are never loaded by the application
or copied into an installer. The production backend is `backend-rust/`.

`tests/rust/` tests the Rust executable. `tests/unit/` still contains tests of
the old implementation: passing them does not establish Rust behavior. Move
meaningful behavior cases to Rust/HTTP tests before removing their modules.
Keep cross-language credential and backup format oracles. The `yaml` development
dependency remains necessary for the legacy tests.
