# Putting the game on the web with Vercel

The repo builds as a plain static site: `npm run build` writes every page into `dist/`, and
Vercel serves that folder. There is no server code, so there is nothing to configure beyond
connecting the repo. `vercel.json` only turns on clean addresses (`/places` as well as
`/places.html`).

| Page | Address on the site |
|---|---|
| The 2D game | `/` |
| The 3D game | `/proto` |
| Real Town Plans | `/places` |
| Demos | `/ground-demo`, `/bridges-demo`, `/industries-demo`, `/people-demo`, `/vehicles-demo`, `/water-demo` |

## Connect the repo (once, from a phone)

It takes about five minutes. The free Hobby plan is enough.

1. In your phone's browser, open **vercel.com** and tap **Sign Up** (or **Log In**).
2. Choose **Hobby**, type a name, then tap **Continue with GitHub** and sign in to GitHub.
3. GitHub asks you to authorise Vercel. Tap **Authorize Vercel**.
4. On Vercel's dashboard, tap **Add New…**, then **Project**.
5. Under **Import Git Repository**, look for **gamex**.
   - If it isn't listed, tap **Adjust GitHub App Permissions** (or **Install**). On GitHub,
     choose **Only select repositories**, pick **Libra-RobBaldwin/gamex**, and tap **Save**
     (or **Install**). You're sent back to Vercel and gamex is now listed.
6. Tap **Import** next to **gamex**.
7. On **Configure Project**, leave everything as it is:
   - **Framework Preset** already says **Vite**;
   - **Root Directory** is `./`;
   - the build command (`npm run build`) and output folder (`dist`) are filled in for you.
8. Tap **Deploy**. The first build takes a minute or two. When it finishes, tap the picture
   of the site, or **Continue to Dashboard** and then **Visit**.

Your site's address is shown under **Domains**, something like `gamex-xyz.vercel.app`.
Add `/places` to it for Real Town Plans.

## Make the site follow the branch you play

Vercel builds **every branch** you push to. Each branch gets its own preview address. The
**production** address (`gamex-xyz.vercel.app`) follows one branch. To start with, that's
the repo's default branch, `claude/runescape-transport-puzzle-game-q1uhy8`, which doesn't
have Real Town Plans yet. To follow the integration branch instead:

1. In the project on Vercel, tap **Settings**, then **Environments**, then **Production**.
2. Under **Branch Tracking**, type `claude/cloud-session-history-rvqkm1` and tap **Save**.
   (On older screens this is **Settings → Git → Production Branch**.)
3. Tap **Deployments**. On the newest one from that branch, tap the **⋯** menu, then
   **Promote to Production** (or **Redeploy**).

From then on, every push to the integration branch updates the production address within a
couple of minutes.

To try a branch before it's merged, open **Deployments**, tap the one for that branch, then
**Visit**. Its address looks like `gamex-git-<branch>-<you>.vercel.app`. Vercel protects
preview addresses so that only you can open them while you're logged in. The production address
is public.

## If a build fails

Tap the failed deployment, then **Building**, to see the log. It runs the same checks as
`npm run build` locally: the TypeScript check, then Vite. Anything that fails there fails
here too. Vercel uses Node 22 by default, which this repo needs (Vite 8 needs Node 20.19 or
later).

## What the site talks to

Everything runs in the visitor's browser. The site itself never receives a postcode or any
map data.

- **postcodes.io**: Real Town Plans sends the postcode there to find it, and nowhere else.
- **tile.openstreetmap.org**: the base map on the area picker. OpenStreetMap's
  [tile policy](https://operations.osmfoundation.org/policies/tiles/) allows light use like
  this, with the credit shown. If the site ever gets busy, switch `TILE_URL` in
  `src/places/map.ts` to a paid tile provider.
- **The public Overpass servers**: the map data for an area, one tile at a time.
