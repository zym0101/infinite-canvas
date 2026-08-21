#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONOFORM="$ROOT/.local/monoform-previs-studio"

if [[ ! -f "$MONOFORM/package.json" ]]; then
    printf '%s\n' "Missing $MONOFORM. Clone GuiYi-Xi/monoform-previs-studio there first." >&2
    exit 1
fi

cd "$MONOFORM"
[[ -d node_modules ]] || npm install
[[ -f dist/index.html ]] || npm run build
exec npm run preview -- --host 0.0.0.0 --port 41736 --strictPort
