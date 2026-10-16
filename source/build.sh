#!/bin/sh
# Builds the app from source/src into the repository root (GitHub Pages serves the root).
# vendor/ (Firebase SDK, PDF libraries) and icons/ live at the root and are not rebuilt here.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/src"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
{ cat "$SRC/logic.js"; printf '\n'; cat "$SRC/app-core.js" "$SRC/app-views.js" "$SRC/app-editor.js" "$SRC/app-extra.js" "$SRC/platform.js" "$SRC/app-main.js"; } > "$ROOT/app.js"
BUILD=$(cat "$ROOT/app.js" "$SRC/head.html" "$SRC/body.html" "$SRC/config.js" "$SRC/sw.js" | sha1sum | cut -c1-10)
{
  cat "$SRC/shell-head.html"
  cat "$SRC/head.html"
  printf '</head>\n<body>\n'
  cat "$SRC/body.html"
  sed "s/__BUILD__/$BUILD/g" "$SRC/shell-tail.html"
} > "$ROOT/index.html"
sed "s/__BUILD__/$BUILD/g" "$SRC/sw.js" > "$ROOT/sw.js"
cp "$SRC/config.js" "$SRC/manifest.webmanifest" "$ROOT/"
echo "$BUILD" > "$ROOT/build.txt"
echo "built $BUILD"
