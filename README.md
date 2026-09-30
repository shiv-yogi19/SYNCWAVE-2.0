# SYNCWAVE — Listen Together. Your Way.
Created by Shiv Yogi.

A Master picks a local audio file, and listeners join with a 6-digit code. Audio streams peer-to-peer over WebRTC.
The Cloudflare Worker + Durable Object only handle room state and signaling (WebSocket). No audio is uploaded or stored; there is no R2, D1 or any database.

## Deploy
```
npm install
npx wrangler deploy
```
No extra setup. Connect the GitHub repo in Cloudflare Workers (build command: none, deploy command: `npx wrangler deploy`).
Local dev: `npx wrangler dev` (use two browser windows; microphone/HTTPS not required).

## How it works
- `POST /api/create` picks a cryptographically random 6-digit code and a secret master token. Only the holder of the token can become Master.
- `/ws?room=CODE&role=master|listener` connects to that room's Durable Object. All messages are validated and size/rate limited.
- The Master builds `File -> <audio> -> GainNode -> AnalyserNode -> MediaStreamDestination` and sends that stream to each listener over its own `RTCPeerConnection`.
- Play/pause/seek/volume/song events carry a server timestamp; listeners compute the position from elapsed time (no continuous position broadcast).
- Volume (0–200%) is applied by the Master's GainNode before the stream, so every listener hears it.
- Late join: the server sends current state, then the Master offers a new peer connection. Listeners hear the live stream and the UI shows the calculated position.

## ICE / TURN
Default is Google's public STUN. Some networks (strict NAT, mobile carriers) need TURN. Set the `ICE_SERVERS` var in `wrangler.jsonc` (JSON array of RTCIceServer objects, e.g. add `{"urls":"turn:...","username":"...","credential":"..."}`); no code changes needed. Put credentials in a Wrangler secret named `ICE_SERVERS` rather than committing them.

## Notes
- Rooms live in Durable Object memory; they disappear when empty. If the Master drops, the room is kept for 45 seconds.
- Browsers require a tap to start audio; listeners see "Tap to start listening" when autoplay is blocked.
- iOS install prompts prefer PNG icons; add 192/512 PNGs to the manifest if you want a perfect home-screen icon.

## SYNCWAVE 2.0 additions
- **Two sources:** Master can upload a local file (WebRTC, real Web Audio analysis) or paste a YouTube URL (official IFrame Player API only; nothing is downloaded or proxied). Listeners follow state (`src`, `vid`, position, play/pause, volume) and correct drift on a ~10 s `tick`.
- **YouTube visuals are ambient:** the official player exposes no audio data, so visuals in YouTube mode are playback-driven motion and are labelled as such. YouTube volume caps at 100%.
- **Visualizer:** full-screen canvas behind the whole UI, 17 modes, RGB/single/dual/multi/random/custom colours, all settings live and saved in localStorage (`sw-cfg`, prefs only).
- **Audio information** (Settings): sample rate, codec, channels and bitrate come from `RTCPeerConnection.getStats()`; anything unmeasurable shows "Auto" / "Not available".
- Share link: `/?room=CODE` pre-fills the join screen.
