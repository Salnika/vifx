# Vifx Playground iOS Host

This is the formal iOS host marker for Program B validation.

The host is intentionally minimal. It gives `vifx native doctor` and `vifx native build|install|launch --dry-run` a stable Xcode project marker, bundle identifier, and signing settings to inspect. The current repository validation does not claim that this host builds or launches on a simulator yet.
