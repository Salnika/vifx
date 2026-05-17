# @vifx/native-artifacts

Native-ready artifact preparation, host diagnostics, and runtime target diagnostics for Vifx bundle outputs.

This package copies a Vifx bundle result into a deterministic iOS or Android artifact directory, writes a manifest for native hosts, validates host/signing markers, checks simulator/emulator/device readiness, creates native build/install/launch command plans, and reports local native toolchain readiness. It does not prove native runtime parity by itself.
