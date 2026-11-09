#!/usr/bin/env bash
set -euo pipefail
mkdir -p diagnostics
collect_diagnostics() {
  result=$?
  timeout 10s adb logcat -d -s AndroidRuntime PGOneQR > diagnostics/android-runtime.txt 2>&1 || true
  free -m > diagnostics/host-memory.txt || true
  sudo -n dmesg 2>/dev/null | tail -n 80 > diagnostics/host-kernel.txt || true
  cp -R /tmp/android-runner/emu-crash-* diagnostics/emulator-crash 2>/dev/null || true
  if [[ -n "${logcat_pid:-}" ]]; then kill "$logcat_pid" 2>/dev/null || true; fi
  exit "$result"
}
trap collect_diagnostics EXIT
adb logcat -v threadtime > diagnostics/device-logcat.txt 2>&1 &
logcat_pid=$!
mkdir -p diagnostics/android-screenshots
adb install mobile/app/build/outputs/apk/debug/app-debug.apk
adb install mobile/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell settings put secure show_ime_with_hard_keyboard 1

# Capture a real cold launch before fixture injection. Hosted emulator video
# recording disconnected the AVD before instrumentation; PNG captures avoid
# that codec path while retaining real startup and presented-frame evidence.
adb shell settings put global animator_duration_scale 1.0
adb shell am force-stop com.safehouse.pg.testing
mkdir -p diagnostics/cold-frames
adb shell am start -W com.safehouse.pg.testing/com.safehouse.pg.MainActivity > diagnostics/cold-start.txt &
launch_pid=$!
index=0
for delay in 0.3 0.5 1 2 3; do
  sleep "$delay"
  adb exec-out screencap -p > "diagnostics/cold-frames/$index.png"
  index=$((index + 1))
done
wait "$launch_pid"
adb shell am force-stop com.safehouse.pg.testing
adb shell settings put global animator_duration_scale 0.0

adb shell am instrument -w com.safehouse.pg.testing.test/androidx.test.runner.AndroidJUnitRunner | tee diagnostics/instrumentation.txt
adb pull /sdcard/Android/data/com.safehouse.pg.testing/files/qa/. diagnostics/android-screenshots/ || true
adb logcat -d -s AndroidRuntime > diagnostics/android-runtime.txt
grep -Eq '^OK \([1-9][0-9]* tests?\)' diagnostics/instrumentation.txt
