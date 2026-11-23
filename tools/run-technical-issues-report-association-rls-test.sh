#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_CONFIG_BIN="${PG_CONFIG:-$(command -v pg_config || true)}"
if [[ -z "$PG_CONFIG_BIN" ]]; then
  echo "pg_config is required for the isolated PostgreSQL RLS test." >&2
  exit 2
fi
PG_BIN="$("$PG_CONFIG_BIN" --bindir)"
for binary in initdb pg_ctl createdb psql; do
  if [[ ! -x "$PG_BIN/$binary" ]]; then
    echo "Missing PostgreSQL binary: $PG_BIN/$binary" >&2
    exit 2
  fi
done
if [[ "$(id -un)" == root ]]; then
  echo "Run this test as a non-root user; initdb refuses root." >&2
  exit 2
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/riwaq-tech-report-rls.XXXXXX")"
cleanup() {
  if [[ -f "$TEMP_ROOT/data/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM
mkdir -p "$TEMP_ROOT/socket"
PORT="$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
"$PG_BIN/initdb" -D "$TEMP_ROOT/data" --auth=trust --username="$(id -un)" --no-locale --encoding=UTF8 >/dev/null
"$PG_BIN/pg_ctl" -D "$TEMP_ROOT/data" -o "-k $TEMP_ROOT/socket -p $PORT -c listen_addresses=''" -l "$TEMP_ROOT/postgres.log" -w start >/dev/null
"$PG_BIN/createdb" -h "$TEMP_ROOT/socket" -p "$PORT" -U "$(id -un)" riwaq_technical_report_rls
if ! "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$TEMP_ROOT/socket" -p "$PORT" -U "$(id -un)" \
  -d riwaq_technical_report_rls -f "$ROOT/tools/technical-issues-report-association-rls.sql" \
  >"$TEMP_ROOT/test.log" 2>&1; then
  tail -n 80 "$TEMP_ROOT/test.log" >&2
  tail -n 30 "$TEMP_ROOT/postgres.log" >&2
  exit 1
fi
grep 'PASS' "$TEMP_ROOT/test.log"
echo "PASS combined migration/RLS suite on disposable PostgreSQL"
