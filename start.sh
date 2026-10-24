#!/usr/bin/env bash
# WindCast — one-command local run (macOS / Linux / WSL).
#   ./start.sh            -> UI + API on http://localhost:8000
#   PORT=8010 ./start.sh  -> different port
#   PYTHON=/path/to/python3.12 ./start.sh  -> force an interpreter
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

# ---------------------------------------------------------------------------
# Threading guards. Mixing toolchains on macOS can crash numpy+BLAS at import.
# Single-threaded BLAS is slower but rock solid, and this dataset is tiny.
# ---------------------------------------------------------------------------
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
export VECLIB_MAXIMUM_THREADS="${VECLIB_MAXIMUM_THREADS:-1}"
export KMP_DUPLICATE_LIB_OK=TRUE

# ---------------------------------------------------------------------------
# 1. Pick a supported interpreter: 3.10 – 3.13.
#    Python 3.14 has no stable numpy/pandas wheels yet and segfaults on macOS,
#    so we deliberately avoid it and fall back to a 3.12/3.13 install.
# ---------------------------------------------------------------------------
supports() { # $1 = interpreter path -> prints "3.12" and exits 0 if supported
  "$1" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)' 2>/dev/null || return 1
  "$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])'
}

PYBIN=""
PYVER=""
CANDIDATES=()
[ -n "${PYTHON:-}" ] && CANDIDATES+=("$PYTHON")
CANDIDATES+=(python3.12 python3.13 python3.11 python3.10
             /usr/local/bin/python3.12 /usr/local/bin/python3.13
             /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.13
             /usr/local/opt/python@3.12/libexec/bin/python3
             /opt/homebrew/opt/python@3.12/libexec/bin/python3
             python3 python)

for cand in "${CANDIDATES[@]}"; do
  command -v "$cand" >/dev/null 2>&1 || continue
  if ver=$(supports "$cand"); then PYBIN=$(command -v "$cand"); PYVER="$ver"; break; fi
done

if [ -z "$PYBIN" ]; then
  echo "[ERROR] No supported Python (3.10-3.13) found."
  echo "        Your default 'python3' is: $(python3 -V 2>&1 || echo 'not installed')"
  echo "        Python 3.14 is not supported yet (no stable numpy/pandas wheels)."
  echo
  echo "        macOS fix:"
  echo "          brew install python@3.12"
  echo "          PYTHON=/usr/local/bin/python3.12 ./start.sh      # Intel Mac"
  echo "          PYTHON=/opt/homebrew/bin/python3.12 ./start.sh   # Apple Silicon"
  exit 1
fi
echo "==> 1/4 Python environment (Python $PYVER at $PYBIN)"

# Rebuild the venv if it is missing or was created with a different interpreter.
if [ -d .venv ]; then
  CURVER=$(./.venv/bin/python -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "")
  if [ "$CURVER" != "$PYVER" ]; then
    echo "    existing .venv uses Python ${CURVER:-unknown} -> recreating with $PYVER"
    rm -rf .venv
  fi
fi
[ -d .venv ] || "$PYBIN" -m venv .venv

./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r backend/requirements.txt

echo "    checking scientific stack…"
if ! ./.venv/bin/python -c "import numpy, pandas" >/dev/null 2>&1; then
  echo
  echo "[ERROR] numpy/pandas cannot be imported in this environment."
  echo "        Fix:  rm -rf .venv && PYTHON=$PYBIN ./start.sh"
  echo "        Run ./diagnose.sh and share the output if it persists."
  exit 1
fi
./.venv/bin/python -c "import numpy, pandas; print('    numpy', numpy.__version__, '| pandas', pandas.__version__)"

# ---------------------------------------------------------------------------
# 2 + 3. Front-end
# ---------------------------------------------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm not found. Install Node.js 18+ (https://nodejs.org) and retry."
  exit 1
fi

echo "==> 2/4 Front-end dependencies"
if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

echo "==> 3/4 Building the UI"
(cd frontend && npm run build >/dev/null && echo "    build ok")

# ---------------------------------------------------------------------------
# 4. Serve everything from one process
# ---------------------------------------------------------------------------
echo "==> 4/4 Starting WindCast"
export DATA_DIR="$(pwd)/data/snapshot"
export STATIC_DIR="$(pwd)/frontend/dist"
echo
echo "    App       : http://localhost:$PORT"
echo "    API docs  : http://localhost:$PORT/docs"
echo "    Stop with : Ctrl + C"
echo
exec ./.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port "$PORT" --workers 1
