#!/usr/bin/env bash
# Serialise pnpm install/add across parallel agents in this workspace.
#   scripts/pnpm-serial.sh add -D --filter @showsteps/core fflate
LOCK="$(cd "$(dirname "$0")/.." && pwd)/.pnpm-serial.lock"
until mkdir "$LOCK" 2>/dev/null; do
  pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
  sleep 2
done
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
pnpm "$@"
