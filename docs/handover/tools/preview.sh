#!/bin/bash
# preview.sh <ref|MAIN> <page.html> <name>
# Builds <page.html> from a branch (or the main working tree) into $SP/prev/<name>/ with relative
# paths, ready to publish as an artifact; prints the files map for the Artifact tool.
set -e
REF=$1; PAGE=$2; NAME=$3
SP=/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad
OUT=$SP/prev/$NAME; WT=/tmp/claude-0/prevtree-$NAME
cd /home/user/gamex
if [ "$REF" = "MAIN" ]; then SRC=/home/user/gamex; else
  git fetch -q origin "$REF" 2>/dev/null || true
  git worktree remove --force $WT 2>/dev/null || true
  R=$REF; git rev-parse -q --verify "refs/heads/$REF" >/dev/null || R=origin/$REF
  git worktree add -q --detach $WT $R; SRC=$WT
  if cmp -s $SRC/package.json /home/user/gamex/package.json; then ln -sfn /home/user/gamex/node_modules $SRC/node_modules
  else (cd $SRC && npm install --silent >/dev/null 2>&1); fi
fi
cd $SRC
cat > /tmp/claude-0/prev-$NAME.config.mjs <<CFG
import { resolve } from 'node:path';
export default { root: '$SRC', base: './', build: { outDir: '$OUT/build', emptyOutDir: true, rollupOptions: { input: { page: resolve('$SRC', '$PAGE') } } } };
CFG
npx vite build --config /tmp/claude-0/prev-$NAME.config.mjs >/tmp/claude-0/prev-$NAME.log 2>&1 || { echo "BUILD FAILED"; tail -20 /tmp/claude-0/prev-$NAME.log; exit 1; }
cp $OUT/build/$PAGE $OUT/$NAME.html
cd $OUT/build && python3 -c "
import json,os
m={}
for d,_,fs in os.walk('assets'):
  for f in fs: m[os.path.join(d,f)]=os.path.join('$OUT/build',d,f)
print(json.dumps(m))"
