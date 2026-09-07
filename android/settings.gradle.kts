// Katha's Android workspace. `katha-kit` is deliberately a plain Kotlin/JVM
// library, not an Android one: it is the mirror of ios/KathaKit, and keeping it
// off the Android plugin means it compiles and tests in seconds with no SDK, no
// emulator and no device — the same reason the Swift package is separate from
// the app target.
rootProject.name = "katha-android"
include(":katha-kit")
