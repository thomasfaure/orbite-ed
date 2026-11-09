#!/bin/sh
set -eu
cd /mnt/HD/HD_a2/orbite/ed-family
unset HOST PORT
export ORBITE_NAS_INSTANCE="$PWD"
exec /mnt/HD/HD_a2/orbite/runtime/node --env-file=.env server.js
