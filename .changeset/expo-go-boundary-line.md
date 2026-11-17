---
"@vifx/cli": patch
---

`vifx expo dev --expo-go` no longer prints a "Boundary" warning each time it starts. It was a reminder of what Vifx does not replace (Expo's native runtimes, EAS, app binaries), not a problem with the run.
