# Pet

Local base for a shared online pet. Later, the shared state can be moved to a Vercel database.

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
