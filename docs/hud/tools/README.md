# HUD browser checks

Playwright scripts for the HUD. Run them from a folder that has `playwright-core@1.56` installed
(`npm i playwright-core@1.56`), with the Vite dev server on port 5173 (`npx vite --host 127.0.0.1 --port 5173`).
Chromium renders in software here, so each script waits 11 s after load.

- `node flows.mjs <outdir> 412x915`: rest (prints chrome coverage), Build, a road tool, a blueprint, Transport, Layers, Menu, the stats drawer, a junction's info sheet and editor, a building's info sheet. Screenshots go to `<outdir>`.
- `node flows2.mjs <outdir> 412x915`: first-run pill, speed, perf readout, road picker, curve tool with Undo, building a road, rail, the bus stop tool and planner, Lines, Quality, New town, Plan view, the compass.
- `node montage.mjs out.png 270 a.png b.png ...`: puts screenshots side by side.

Coverage is the share of sampled pixels (every other one) whose top element is part of the HUD.

## Review checks

`review-portrait/`, `review-landscape/` and `review-parity/` hold the checks written by three adversarial reviews of
the HUD. They cover portrait phones, landscape, rotation and safe areas, and parity with the old HUD. Each script prints
PASS or FAIL: run it with `node <script> <WxH>` from a folder where `playwright-core` resolves. All of them pass on
this branch. Screenshots go to `./shots/` or next to the script.
