# Vifx Playground Android Host

This is the formal Android host marker for Program B validation.

The host is intentionally minimal. It gives `vifx native doctor` and `vifx native build|install|launch --dry-run` stable Gradle files, an application id, and signing markers to inspect. The current repository validation does not claim that this host builds or launches on an emulator yet.
