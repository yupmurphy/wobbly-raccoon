#!/usr/bin/env bash
# Build the Android app and publish it to docs/.
#
# The order here matters and is the whole point of this script. docs/ is
# Capacitor's webDir, so anything sitting in it gets copied inside the app.
# Leave the previous APK there and each build packs the last one inside the
# new one: 9 MB became 64 MB in three versions before this was caught.
# So: clear the published APK first, sync, build, and only then put the
# fresh one back.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}"

echo "==> clearing published APKs so they cannot be packed into the build"
rm -f docs/*.apk WobblyRaccoon.apk

echo "==> syncing web files into the native project"
npx --yes cap sync android

echo "==> building"
(cd android && ./gradlew assembleDebug --no-daemon)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
cp "$APK" WobblyRaccoon.apk
cp "$APK" docs/WobblyRaccoon.apk

SIZE=$(stat -c%s WobblyRaccoon.apk)
echo "==> built $(( SIZE / 1024 / 1024 )) MB"

# a build that swallowed another APK is broken, say so loudly
# -Z1 lists bare entry names; plain -l prints an "Archive: ...apk" header
# that a naive check matches against itself
if unzip -Z1 WobblyRaccoon.apk | grep -qi '\.apk$'; then
  echo "!! this APK contains another APK - something put one back in docs/ before the sync" >&2
  exit 1
fi
if [ "$SIZE" -gt 20971520 ]; then
  echo "!! unexpectedly large APK ($SIZE bytes) - check what ended up in docs/" >&2
  exit 1
fi

echo "==> ok"
