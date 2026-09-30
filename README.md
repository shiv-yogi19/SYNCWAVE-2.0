# SYNCWAVE 2.0 Fixed

Cloudflare Worker + Durable Object + WebRTC synchronized listening app.

## Project layout

```text
public/
src/
package.json
wrangler.jsonc
README.md
```

## Deploy

Run from this directory:

```bash
npm install
npx wrangler deploy
```

## Important behavior

- Local audio is streamed directly from Master to listeners with WebRTC. Audio files are not uploaded to Cloudflare storage.
- YouTube uses the official YouTube IFrame Player API. The video is synchronized by room state and played by each client locally. The app does not extract, download, proxy, rebroadcast, or bypass YouTube ads.
- No R2 or D1 database is used for audio or room content.
- Room state is held in the Durable Object instance and is not intended as permanent storage.
- A TURN server can be supplied through the `ICE_SERVERS` environment variable when restrictive networks prevent direct WebRTC connectivity.

## Fixed in this build

- WebRTC ICE candidate queuing to avoid signaling race conditions.
- Listener playback now respects the authoritative paused/stopped state.
- YouTube play/pause state is broadcast immediately from Master as well as from player events.
- Master state broadcasting supports both local audio and YouTube mode.
- Master welcome flow re-sends the current state after listener connections are established.
- Listener YouTube synchronization follows the room's authoritative position and playback state.
