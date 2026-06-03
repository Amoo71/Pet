# Pet

Shared online pet game built with Next.js. The game state is synced through `/api/game-state` and can persist online through Vercel KV or Upstash Redis.

## Run Locally

```bash
npm install
npm run dev
```

## Asset Structure

Place PNGs in `public/assets`:

```text
public/assets/backgrounds/Wiese/frame-01.png ... any number of frames
public/assets/pet/sitzen/frame-01.png ... any number of frames
public/assets/pet/stehen/frame-01.png ... any number of frames
public/assets/pet/laufen/frame-01.png ... any number of frames
public/assets/pet/springen/frame-01.png ... any number of frames
public/assets/pet/sleep/frame-01.png ... any number of frames
```

Only the file naming matters: `frame-01.png`, `frame-02.png`, `frame-03.png`, and so on. On start/build, `lib/generatedAssets.ts` is generated automatically.

New rooms, states, and actions are added in `lib/gameConfig.ts`.

Item PNG paths:

```text
public/assets/items/ball.png
public/assets/items/steak.png
public/assets/items/bett.png
```

## Online State On Vercel

For real shared online/live state, connect Vercel KV or Upstash Redis and set these environment variables in Vercel Project Settings:

```text
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

If your provider exposes Upstash names instead, these also work:

```text
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Without these variables, the app falls back to `.data/game-state.json`, which is only reliable for local development and not for real Vercel multiplayer persistence.

When importing this repo on Vercel, set the project root directory to:

```text
Desktop/Haustier
```
