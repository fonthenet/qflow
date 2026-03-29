#!/bin/bash
# Copies Station dist assets to web app's public/station/ folder
# Run after: npm run build:vite (or full build)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_STATION="$SCRIPT_DIR/../web/public/station"
DIST="$SCRIPT_DIR/dist"

# Clean old assets
rm -f "$WEB_STATION/assets/"*

# Copy new assets
cp "$DIST/assets/"* "$WEB_STATION/assets/"

# Get new file names
JS_FILE=$(ls "$WEB_STATION/assets/"*.js 2>/dev/null | head -1 | xargs basename)
CSS_FILE=$(ls "$WEB_STATION/assets/"*.css 2>/dev/null | head -1 | xargs basename)

# Update index.html references
sed -i "s|/station/assets/index-[^\"]*\.js|/station/assets/$JS_FILE|g" "$WEB_STATION/index.html"
sed -i "s|/station/assets/index-[^\"]*\.css|/station/assets/$CSS_FILE|g" "$WEB_STATION/index.html"

echo "Synced Station assets to web:"
echo "  JS:  $JS_FILE"
echo "  CSS: $CSS_FILE"
