#!/bin/sh
set -eu
cd "$(dirname "$0")"
unset HOST PORT
export ORBITE_NAS_INSTANCE="$(pwd -P)"
exec "${ORBITE_NODE:-node}" --env-file=.env dist/server/server.js
