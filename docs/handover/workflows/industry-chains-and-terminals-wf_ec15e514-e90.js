export const meta = {
  name: 'industry-chains-and-terminals',
  description: 'Work out how industries link (validated chain logic + diagram page) and build purchasable road/rail/quay terminal add-ons that unlock as industries grow; review and fix',
  phases: [
    { title: 'Build', detail: 'chain analyst + terminals builder in parallel' },
    { title: 'Review', detail: 'adversarial review of terminals rules and chain balance' },
    { title: 'Fix', detail: 'apply confirmed findings' },
  ],
}

const SP = args.sp
const ISO = `
ISOLATION: you run in your own fresh git worktree (your current directory). Never modify /home/user/gamex (the main checkout — other agents are working there) or other worktrees. First: git status; git fetch origin claude/industries-3d; then create your branch as instructed; npm install.
Commit on your branch with messages: short summary line, blank line, a few bullets, then exactly these trailers:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EDn6ScXmNn8wUEBAmG2GGU
Never push. Report branch and sha. Scratch files only under ${SP}/<your role>/.
`
const COMMON = `
Project: "Untitled", a TypeScript + three.js transport/city game (Transport Fever / OpenTTD genre), played on an Android phone. Comments concise, plain UK English, explaining why; match the existing style. Checks: npx tsc --noEmit ; npx vitest run.
Sources of truth to read:
- origin/claude/industries-3d (a finished branch): src/proto/industries/catalogue.ts (15 UK industry types, 14 cargoes, roles primary/processor/sink/hub/gateway, inputs/outputs per cycle, mix all/any, optional boost inputs, rate, sizes, eras, serve kinds lorry/rail/quay, waterside, catchment; TOWN_ACCEPTS), state.ts (visual state: production 0..4, stock fills, running, neglect), site.ts/models.ts/kit.ts (procedural sites fitted to a plot, with ANCHORS where stations go), overlay.ts (catchment, chain helpers), fx.ts, demo.ts + industries-demo.html (gallery), docs/industries.md, docs/reports/industries.md.
- The original 2D game: src/defs.ts (CARGO, INDUSTRIES, STATIONS with cap), src/sim.ts (industries produce into stock, stations in catchment with freight lines collect it, processors convert inputs, deliveries pay by distance/time, production rises x1.12 when >60% collected, falls back when <15%, capped at 4x), src/sim.test.ts.
- docs/ENGINE.md and docs/ROADMAP.md (economy layer: simulate flows, show agents; eras).
An economy model layer is being ported separately and isn't available yet; define clean interfaces it can adopt.
`
const REPORT = { type: 'object', properties: { branch: { type: 'string' }, sha: { type: 'string' }, summary: { type: 'string' }, files_changed: { type: 'array', items: { type: 'string' } }, evidence: { type: 'string' }, page: { type: 'string', description: 'absolute path of any HTML page produced for publishing, else empty' }, known_issues: { type: 'array', items: { type: 'string' } } }, required: ['branch', 'sha', 'summary', 'files_changed', 'evidence', 'page', 'known_issues'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, where: { type: 'string' }, detail: { type: 'string' }, evidence: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['title', 'severity', 'where', 'detail', 'evidence', 'confirmed'] } }, verdict: { type: 'string' } }, required: ['findings', 'verdict'] }

const PAGE_RULES = `
The HTML page you write will be published by the coordinator as a claude.ai artifact. Rules: write page content only (no <!doctype>, <html>, <head>, <body> tags — a skeleton with charset/viewport is added); put <title> (a 2–4 word name, e.g. "Supply Chains") and <style> at the top; external scripts only from cdnjs.cloudflare.com (pinned UMD builds) and stylesheets only from Google Fonts — inline everything else (inline SVG is ideal for the diagram); define colour tokens on :root, redefine them under @media (prefers-color-scheme: dark) guarded by :root:not([data-theme="light"]) and again under :root[data-theme="dark"], set color-scheme: dark in the dark blocks, give body an explicit token background; must work at phone width (~400px) with a 16px side gutter and no horizontal page scroll (a wide diagram goes in its own overflow-x:auto container, or reflows); visible keyboard focus; no emoji as decoration. Brand ("Untitled"): deep forest green #1f5e3f, darker #0f3322, bright lime #5cb83a for small tab labels, a thin gold rule #b8964e, off-white ground; headings in League Spartan (800), body in Archivo (400/600) via Google Fonts with system fallbacks. Plain, direct copy from the player's side ("Steelworks need both coal and iron ore"). No lorem ipsum; every number from the catalogue.`

const CHAINS = `${ISO.replace('create your branch as instructed', 'git checkout -b chains origin/claude/industries-3d')}${COMMON}
YOUR ROLE: chain analyst. Branch: chains (based on origin/claude/industries-3d).
The user: "On industries — need the logic of how they link together."
Deliver:
1. src/proto/industries/chains.ts (new file): derive the supply-chain graph from the catalogue — nodes are industry types, cargoes and 'town'; edges produce/consume with per-cycle ratios; for each final demand (towns via TOWN_ACCEPTS, sinks like the power station, the docks gateway) the full upstream chain(s); chain depth; which chains need two inputs at once (mix 'all', e.g. steel = coal + iron ore) and which have optional boosts; value added per step (cargo pay rates x amounts in vs out); the "unit rates": how many primary sites of each kind keep one processor at production level 1..4 busy. Plain-English one-line explanations for each industry and each chain ("A colliery's coal goes to a power station, or to a steelworks with iron ore to make steel, which a goods factory turns into goods for towns").
2. Validation with tests (chains.test.ts): every cargo has at least one producer and one consumer; no processor is unreachable; no chain dead-ends at a cargo nobody accepts; every final product reaches towns or a sink; ratios produce sensible balance (flag any chain where a processor would need an absurd number of suppliers, or where value added is negative or tiny so it would never be worth running); era consistency (a chain isn't broken in some era because its consumer doesn't exist yet — report which chains exist in 1850, 1900, 1950, 2000). Fix clear catalogue mistakes you find (catalogue.ts on this branch is yours to adjust — explain each change) and report balance issues you left for the economy.
3. A supply-chain diagram page as HTML at ${SP}/chains/supply-chains.html: an inline SVG (drawn from the graph data you computed, so it's correct — generate it with a small node script that imports chains.ts via vite-node or npx tsx, and write the HTML out), showing primaries on the left, processors in the middle, towns/sinks/docks on the right, cargo-labelled arrows with ratios, 'needs both' markers where mix is 'all', optional boosts dashed; plus a readable chain-by-chain list with the plain-English explanations and an era view (which chains exist in a chosen decade). ${PAGE_RULES}
Commit on branch chains. Return REPORT with page set to the HTML path.`

const TERMINALS = `${ISO.replace('create your branch as instructed', 'git checkout -b terminals origin/claude/industries-3d')}${COMMON}
YOUR ROLE: terminals builder. Branch: terminals (based on origin/claude/industries-3d).
The user: "maybe we have road terminals or rail terminals as add-ons that become available for purchase as they grow?"
Design and build TERMINALS as purchasable add-ons for industries (and optionally towns' goods depots), as new files under src/proto/terminals/ (you may also edit the industries files on this branch where needed — e.g. to expose site anchors or extend the demo — and say why):
1. Catalogue (data): per transport mode, tiers that unlock as the industry grows. Road: loading bay (starter) -> lorry depot -> road freight terminal (more bays, faster loading, lorry park). Rail: private sidings -> rail freight terminal (loading gantry or rapid loader, longer sidings) -> marshalling yard (block trains). Water: jetty -> quay -> container or bulk terminal (cranes). Per tier: cost, upkeep, build time, capacity (tonnes/hour loading and unloading, stockpile size), max trains or lorries or ships served at once, catchment bonus, era availability, cargo suitability (bulk vs general vs liquid: a tank farm for oil and fuel, conveyors for coal and ore), site requirements (rail connection, waterside, footprint, anchor on the site), and a speed-of-loading effect on vehicles' dwell time.
2. Unlock and growth rules (pure logic + tests): an industry's production level (0..4, rising when well served as in the 2D game) is capped by the throughput its terminals can move, so terminals are the upgrade path: when production is pressing against capacity (for example, the stockpile is full or waiting vehicles are queueing), the next tier becomes AVAILABLE TO BUY and the game can suggest it with a plain reason ("Colliery output is stockpiling: a rail freight terminal would move 3x more"). Also: tier requirements (a rail terminal needs a rail line to the site), a mode not offered for an industry that can't use it (catalogue serve kinds, waterside), downgrades or closure if a terminal is left unused (upkeep with no traffic), and how multiple terminals at one site share the output. Include a small economy-facing interface: given industry state + terminals -> effective collection capacity, dwell times, the available upgrades with reasons and costs; and apply(purchase).
3. Geometry: low-poly add-on models for each tier in the industries Kit style (vertex colours, one mesh), placed at the site's anchors and fitted to the plot: bays with canopies, lorry parks, sidings with a loading gantry or rapid loader silo, marshalling fan of tracks, jetty, quay with cranes, tank farm, conveyors. Readable from the isometric camera; within a triangle budget; tests for determinism and budgets.
4. Extend the industries demo (industries-demo.html / demo.ts on this branch) with a "Terminals" panel: for the selected industry, show available tiers per mode with costs, buy/remove to see the models appear, and a readout of capacity vs production so the upgrade logic is visible.
5. docs/terminals.md (API, rules, integration plan with the economy layer and the station/line UI) and docs/reports/terminals.md (decisions, test results, screenshots, known limits). Screenshots with headless Chromium (executablePath /opt/pw-browsers/chromium-1194/chrome-linux/chrome, args --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist; playwright-core is at ${SP}/pw/node_modules) of the demo at 412x915 via the Vite dev server (npx vite --port 4241; open /industries-demo.html).
Commit on branch terminals. Return REPORT (page: empty).`

phase('Build')
const [chains, terms] = await parallel([
  () => agent(CHAINS, { label: 'build:chains', phase: 'Build', schema: REPORT, isolation: 'worktree' }),
  () => agent(TERMINALS, { label: 'build:terminals', phase: 'Build', schema: REPORT, isolation: 'worktree' }),
])
log(`chains: ${chains?.branch} ${chains?.sha} page=${chains?.page}`)
log(`terminals: ${terms?.branch} ${terms?.sha}`)

phase('Review')
const review = terms ? await agent(`${ISO.replace('create your branch as instructed', `git checkout -b terminals-review ${terms.branch}`)}${COMMON}
YOUR ROLE: adversarial reviewer of the terminals rules and the chain balance. Builders' reports: TERMINALS ${JSON.stringify(terms)} CHAINS ${JSON.stringify(chains)}. You're on branch terminals-review (a copy of the terminals branch); you may also git show the chains branch (${chains?.branch ?? 'chains'}).
Try hard to break it, writing focused failing tests in src/proto/terminals/terminals.review.test.ts: exploits (buy/sell terminals to farm refunds; a top-tier terminal on an industry nobody serves; stacking many terminals to exceed caps; downgrade/closure oscillation); upgrades that can never unlock or unlock too early; capacity rules that let production grow without any transport; modes offered where the industry can't use them (no rail, not waterside); era violations; inconsistency with the chains analyst's graph and ratios (e.g. a terminal tier sized for a throughput the chain can't supply); dwell-time effects that make vehicles faster than possible; costs out of proportion with the 2D game's economy; models over budget or misplaced off the site's anchors (run the demo on port 4242 and screenshot). Mark confirmed=true only when a failing test or screenshot proves it. Commit the review tests on terminals-review (they may fail). Return FINDINGS.`, { label: 'review:terminals', phase: 'Review', schema: FINDINGS, isolation: 'worktree' }) : null

phase('Fix')
const conf = (review?.findings ?? []).filter((f) => f.confirmed)
const fix = conf.length ? await agent(`${ISO.replace('create your branch as instructed', 'git checkout -b terminals-2 terminals-review')}${COMMON}
YOUR ROLE: terminals fixer. Branch: terminals-2 (from terminals-review, which holds the builder's work plus failing review tests). Confirmed findings: ${JSON.stringify(conf)}. Reviewer verdict: ${review?.verdict}. Fix each root cause; make every test pass (if a review test is wrong, fix the test and say why); keep budgets; re-take any screenshots that showed a problem (demo on port 4243). Commit on terminals-2. Return REPORT (page: empty).`, { label: 'fix:terminals', phase: 'Fix', schema: REPORT, isolation: 'worktree' }) : null

return { chains, terms, review, fix }
