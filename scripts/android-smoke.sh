#!/usr/bin/env bash
set -euo pipefail
mkdir -p diagnostics/android-screenshots
adb install mobile/app/build/outputs/apk/debug/app-debug.apk
adb install mobile/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

# Record a real cold launch with system animation enabled, before fixture injection.
# The fresh testing package has no credentials and opens the real sign-in screen.
adb shell settings put global animator_duration_scale 1.0
adb shell am force-stop com.safehouse.pg.testing
adb shell screenrecord --time-limit 6 /sdcard/safehouse-cold-start.mp4 &
record_pid=$!
adb shell am start -W com.safehouse.pg.testing/com.safehouse.pg.MainActivity | tee diagnostics/cold-start.txt
wait "$record_pid"
adb pull /sdcard/safehouse-cold-start.mp4 diagnostics/
adb shell am force-stop com.safehouse.pg.testing
adb shell settings put global animator_duration_scale 0.0

adb shell am instrument -w com.safehouse.pg.testing.test/androidx.test.runner.AndroidJUnitRunner | tee diagnostics/instrumentation.txt
adb pull /sdcard/Android/data/com.safehouse.pg.testing/files/qa/. diagnostics/android-screenshots/ || true
adb logcat -d -s AndroidRuntime > diagnostics/android-runtime.txt
grep -q 'OK (1 test)' diagnostics/instrumentation.txt
