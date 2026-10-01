#!/usr/bin/env bash
# Todo lo que necesita los emuladores, en una sola pasada: las reglas, la cola de
# encargos de Python y la web de verdad. Lo lanza `npm run todo` con los
# emuladores ya arriba.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== reglas de Firestore"
(cd tests/firebase && node --test reglas.test.js)

echo "== cola de encargos (Python)"
python -m pytest tests/test_nube.py -q -p no:cacheprovider

echo "== la web contra los emuladores"
npx playwright test -c playwright.nube.config.js
