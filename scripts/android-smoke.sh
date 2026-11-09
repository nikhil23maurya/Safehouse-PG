#!/usr/bin/env bash
set -euo pipefail
mkdir -p diagnostics
collect_diagnostics() {
  result=$?
  timeout 10s adb logcat -d -s AndroidRuntime PGOneQR > diagnostics/android-runtime.txt 2>&1 || true
  free -m > diagnostics/host-memory.txt || true
  sudo -n dmesg 2>/dev/null | tail -n 80 > diagnostics/host-kernel.txt || true
  exit "$result"
}
trap collect_diagnostics EXIT
mkdir -p diagnostics/android-screenshots
adb install mobile/app/build/outputs/apk/debug/app-debug.apk
adb install mobile/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell settings put secure show_ime_with_hard_keyboard 1

# Record a real cold launch with system animation enabled, before fixture injection.
# The fresh testing package has no credentials and opens the real sign-in screen.
adb shell settings put global animator_duration_scale 1.0
adb shell am force-stop com.safehouse.pg.testing
adb shell screenrecord --size 720x1600 --bit-rate 2000000 --time-limit 12 /sdcard/safehouse-cold-start.mp4 &
record_pid=$!
adb shell am start -W com.safehouse.pg.testing/com.safehouse.pg.MainActivity | tee diagnostics/cold-start.txt
wait "$record_pid"
adb pull /sdcard/safehouse-cold-start.mp4 diagnostics/
adb shell am force-stop com.safehouse.pg.testing
adb shell settings put global animator_duration_scale 0.0

adb shell am instrument -w com.safehouse.pg.testing.test/androidx.test.runner.AndroidJUnitRunner | tee diagnostics/instrumentation.txt
adb pull /sdcard/Android/data/com.safehouse.pg.testing/files/qa/. diagnostics/android-screenshots/ || true
adb logcat -d -s AndroidRuntime > diagnostics/android-runtime.txt
grep -Eq '^OK \([1-9][0-9]* tests?\)' diagnostics/instrumentation.txt
