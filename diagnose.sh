#!/usr/bin/env bash
# WindCast — environment diagnostic. Run this if the server crashes or misbehaves:
#     ./diagnose.sh
# It prints nothing sensitive and makes no changes.
set -uo pipefail
cd "$(dirname "$0")"

line() { printf '%s\n' "------------------------------------------------------------"; }

line; echo "WindCast diagnostics"; line

echo "OS            : $(uname -srm)"
echo "Shell         : ${SHELL:-unknown}"
echo "Repo folder   : $(pwd)"
echo "conda active  : ${CONDA_PREFIX:-no}"
echo "python3       : $(command -v python3 || echo 'NOT FOUND')"
echo "python3 -V    : $(python3 -V 2>&1 || true)"
echo "node          : $(command -v node || echo 'NOT FOUND') $(node -v 2>/dev/null || true)"
echo "npm           : $(command -v npm || echo 'NOT FOUND') $(npm -v 2>/dev/null || true)"
line

echo "Data snapshot:"
ls -lh data/snapshot 2>/dev/null || echo "  MISSING - expected data/snapshot/*.csv"
line

if [ -x .venv/bin/python ]; then
  echo "venv python   : $(./.venv/bin/python -V 2>&1)"
  echo "venv base     : $(./.venv/bin/python -c 'import sys;print(sys.base_prefix)' 2>/dev/null)"
  echo
  echo "Import checks (each line should say OK):"
  for mod in numpy pandas requests fastapi uvicorn; do
    if out=$(./.venv/bin/python -c "import $mod; print(getattr($mod,'__version__','?'))" 2>&1); then
      printf '  %-8s OK   %s\n' "$mod" "$out"
    else
      printf '  %-8s FAIL %s\n' "$mod" "$(echo "$out" | tail -1)"
    fi
  done
  echo
  echo "Snapshot load test:"
  if out=$(DATA_DIR="$(pwd)/data/snapshot" ./.venv/bin/python -c \
      "from backend.app import analytics; s=analytics.load_snapshot(); print('actuals', len(s.actuals), 'forecasts', len(s.forecasts))" 2>&1); then
    echo "  OK   $out"
  else
    echo "  FAIL $(echo "$out" | tail -3)"
  fi
else
  echo "venv          : MISSING (run ./start.sh first)"
fi
line

echo "Ports in use (8000/8080/5173):"
if command -v lsof >/dev/null 2>&1; then
  for p in 8000 8080 5173; do
    pid=$(lsof -ti tcp:$p 2>/dev/null | head -1)
    [ -n "$pid" ] && echo "  :$p held by pid $pid ($(ps -p "$pid" -o comm= 2>/dev/null))" || echo "  :$p free"
  done
else
  echo "  lsof not available"
fi
line
echo "Paste this whole output when reporting a problem."
