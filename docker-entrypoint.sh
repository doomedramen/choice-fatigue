#!/bin/sh
set -eu

pnpm db:deploy
exec pnpm start
