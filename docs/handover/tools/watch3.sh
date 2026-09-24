#!/bin/bash
# One line per thing that lands: workflow stages finishing, local stream branches, cloud session branches.
# State persists in state/ so re-arming the watch doesn't repeat old events.
cd /home/user/gamex
S=/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/watch/state; mkdir -p $S
W=/root/.claude/projects/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/subagents/workflows
tick=0
while true; do
  for wf in wf_d8f4e858-86e wf_7efd5802-eae wf_ec15e514-e90 wf_1a71bbbf-98a wf_e56840b9-fd2 wf_20c6cc09-48b; do
    j=$W/$wf/journal.jsonl; [ -f $j ] || continue
    n=$(grep -vc '"type":"started"\|"type":"launched"' $j); o=$(cat $S/$wf 2>/dev/null || echo 0)
    if [ "$n" != "$o" ]; then
      grep -v '"type":"started"\|"type":"launched"' $j | tail -n $((n - o)) | python3 -c "
import sys,json
for l in sys.stdin:
  try: d=json.loads(l)
  except: continue
  print('WORKFLOW $wf', d.get('type'), d.get('label') or d.get('agentId') or '', str(d.get('error') or '')[:120], flush=True)"
      echo $n > $S/$wf
    fi
  done
  for b in economy-model economy-review economy-model-2 ui-overhaul ui-overhaul-2 chains terminals terminals-review terminals-2 bridges-track bridges-track-review bridges-track-2 ground ground-review-look ground-review-perf ground-2 ground-3 kit-nav kit-nav-review kit-nav-2 vehicles-moving vehicles-moving-review vehicles-moving-2; do
    sha=$(git rev-parse -q --verify refs/heads/$b 2>/dev/null)
    [ -n "$sha" ] && [ "$sha" != "$(cat $S/local-$b 2>/dev/null)" ] && { echo "LOCAL BRANCH $b $sha"; echo $sha > $S/local-$b; }
  done
  if [ $((tick % 3)) -eq 0 ]; then
    git ls-remote origin 'refs/heads/claude/*' 2>/dev/null | while read sha ref; do
      b=${ref#refs/heads/}; [ "$b" = "claude/runescape-transport-puzzle-game-q1uhy8" ] && continue
      f=$S/remote-${b//\//_}
      [ "$sha" != "$(cat $f 2>/dev/null)" ] && { echo "REMOTE BRANCH $b $sha"; echo $sha > $f; }
    done
  fi
  tick=$((tick + 1)); sleep 60
done
