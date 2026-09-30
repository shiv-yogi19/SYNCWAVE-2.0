"use strict";
const $ = (s) => document.querySelector(s);
const cfg = { style: 0, sens: 1, intensity: 1, speed: 1, smooth: .6, bassR: 1, midR: 1, trebR: 1, vis: true, perf: false, lite: false, parts: true, cm: "rgb", c1: "#8f7dff", c2: "#3ee6d3", bright: 1, sat: 1, vglow: .6, bloom: true, trails: true, vig: false, pulse: false, pamt: 1, q: "1", fps: "60" };
try { Object.assign(cfg, JSON.parse(localStorage.getItem("sw-cfg") || "{}")); } catch {}
function saveCfg() { try { const o = {}; for (const e of document.querySelectorAll("[data-k]")) o[e.dataset.k] = cfg[e.dataset.k]; localStorage.setItem("sw-cfg", JSON.stringify(o)); } catch {} }
function bindCfg() { // visualizer/effect prefs only; never room state
  for (const el of document.querySelectorAll("[data-k]")) {
    const k = el.dataset.k, v = cfg[k];
    if (el.type === "checkbox") el.checked = !!v; else el.value = el.type === "range" ? Math.round(v * 100) : v;
    el.addEventListener("input", () => { cfg[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? el.value / 100 : el.value; if (k === "c1" || k === "c2") hues(); if (k === "vig") document.body.classList.toggle("vig", cfg.vig); saveCfg(); });
  }
  hues(); document.body.classList.toggle("vig", !!cfg.vig);
}
const S = {};
function resetState() {
  Object.assign(S, { role: null, code: null, token: null, ws: null, id: null, ice: [{ urls: "stun:stun.l.google.com:19302" }], offset: 0,
    room: { songName: "", fileName: "", duration: 0, isPlaying: false, masterPosition: 0, volume: 1, lastStateUpdate: 0 },
    ctx: null, gain: null, analyser: null, dest: null, audio: null, url: null, pcs: new Map(), pc: null, remote: null, vsrc: null,
    retry: 0, closing: false, masterOnline: true, timers: [], dragging: false, resynced: 0, active: false, src: "local", lb: null });
}
resetState();

/* ---------- UI helpers ---------- */
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200); }
function show(id) {
  for (const s of document.querySelectorAll(".scr")) s.hidden = s.id !== id;
  $("#homeBtn").hidden = id === "home";
  $("#code").blur();
}
const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
function setStatus(txt) {
  const el = $("#status"); el.textContent = txt;
  el.className = "pill st " + (txt === "CONNECTED" ? "ok" : txt === "CONNECTION FAILED" ? "bad" : "");
}
function safe(fn) { return (...a) => { try { const r = fn(...a); if (r && r.catch) r.catch((e) => { console.error(e); toast("Something went wrong"); }); } catch (e) { console.error(e); toast("Something went wrong"); } }; }
const ERR = { ROOM_NOT_FOUND: "Room not found", ROOM_FULL: "Room is full", FORBIDDEN: "Could not create room", BAD_ROLE: "Connection failed" };

/* ---------- settings ---------- */
let infoT = 0;
const root = document.documentElement.style;
function bindSettings() {
  const on = (id, f) => $(id).addEventListener("input", safe((e) => f(e.target)));
  on("#sOp", (t) => root.setProperty("--glass-opacity", t.value / 100));
  on("#sBl", (t) => root.setProperty("--glass-blur", t.value + "px"));
  on("#sGl", (t) => root.setProperty("--glass-glow", t.value / 100));
  on("#sBg", (t) => document.body.classList.toggle("noaurora", !t.checked));
  on("#sPa", (t) => { cfg.parts = t.checked; particles(); });
  bindCfg();
  on("#sVi", (t) => { cfg.vis = t.checked; syncViz(); });
  const lite = () => { cfg.perf = $("#sPf").checked; cfg.lite = $("#sRe").checked || $("#sLo").checked; document.body.classList.toggle("lite", cfg.lite); if ($("#sLo").checked) { cfg.parts = false; $("#sPa").checked = false; } particles(); };
  for (const id of ["#sPf", "#sRe", "#sLo"]) $(id).addEventListener("input", safe(lite));
  $("#setBtn").onclick = () => { const l = S.ctx ? (S.ctx.baseLatency || 0) + (S.ctx.outputLatency || 0) : 0; $("#lat").textContent = l ? Math.round(l * 1000) + " ms" : "n/a"; $("#setDlg").showModal(); audioInfo(); clearInterval(infoT); infoT = setInterval(audioInfo, 2000); };
  $("#setClose").onclick = () => $("#setDlg").close();
  $("#setDlg").addEventListener("close", () => clearInterval(infoT));
}

/* ---------- particles (cheap, stops when hidden/disabled) ---------- */
let pRaf = 0, pts = [];
function particles() {
  const c = $("#parts"), g = c.getContext("2d");
  cancelAnimationFrame(pRaf); pRaf = 0; g.clearRect(0, 0, c.width, c.height);
  if (!cfg.parts || document.hidden) return;
  c.width = innerWidth; c.height = innerHeight;
  if (!pts.length) pts = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + .4, v: Math.random() * .00012 + .00003 }));
  const loop = () => {
    pRaf = requestAnimationFrame(loop);
    g.clearRect(0, 0, c.width, c.height); g.fillStyle = "rgba(200,190,255,.5)";
    for (const p of pts) { p.y -= p.v * 16; if (p.y < 0) p.y = 1; g.beginPath(); g.arc(p.x * c.width, p.y * c.height, p.r, 0, 6.3); g.fill(); }
  };
  loop();
}

/* ---------- audio graph ---------- */
function makeCtx() { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error("no audio"); S.ctx = new AC(); S.analyser = S.ctx.createAnalyser(); S.analyser.fftSize = 2048; S.analyser.smoothingTimeConstant = .8; }
function initMasterAudio() {
  makeCtx();
  S.audio = new Audio(); S.audio.preload = "auto";
  const src = S.ctx.createMediaElementSource(S.audio);
  S.gain = S.ctx.createGain(); S.dest = S.ctx.createMediaStreamDestination();
  // File -> HTMLAudioElement -> Gain -> Analyser -> WebRTC stream (+ local monitor)
  src.connect(S.gain); S.gain.connect(S.analyser); S.analyser.connect(S.dest); S.analyser.connect(S.ctx.destination);
  S.audio.addEventListener("loadedmetadata", safe(() => { S.room.duration = S.audio.duration || 0; pushState("song"); updateUI(); }));
  S.audio.addEventListener("error", () => { if (S.audio.src) toast("Unsupported audio format"); });
  S.audio.addEventListener("ended", safe(() => { S.room.isPlaying = false; pushState("pause"); updateUI(); }));
}

/* ---------- signaling ---------- */
function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let u = `${proto}://${location.host}/ws?room=${S.code}&role=${S.role}`;
  if (S.role === "master") u += `&token=${encodeURIComponent(S.token)}`;
  const ws = new WebSocket(u); S.ws = ws;
  ws.onopen = () => { S.retry = 0; clearInterval(S.hb); S.hb = setInterval(() => send({ type: "ping" }), 25000); };
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); toast("Something went wrong"); } };
  ws.onclose = () => {
    if (S.ws !== ws || S.closing) return;
    clearInterval(S.hb); setStatus("RECONNECTING");
    if (++S.retry > 8) { setStatus("CONNECTION FAILED"); toast("Connection lost"); return; }
    setTimeout(() => { if (!S.closing && S.ws === ws) { if (S.role === "listener") closePeer(); connect(); } }, Math.min(1000 * 2 ** S.retry, 10000));
  };
}
async function onMsg(m) {
  switch (m.type) {
    case "welcome":
      S.id = m.id; S.offset = m.serverTime - Date.now(); applyRoom(m.state, "welcome");
      if (S.role === "master") { for (const id of m.listeners) await offer(id); if (S.room.songName || S.audio.src) pushState("song"); setStatus("CONNECTED"); updateCount(m.listeners.length); }
      else { S.masterOnline = m.masterOnline; setStatus("CONNECTING"); updateUI(); }
      break;
    case "error": {
      S.closing = true; const msg = ERR[m.code] || "Connection failed";
      if (S.role === "listener" && m.code !== "FORBIDDEN") { cleanup(); joinScreen(msg); } else { cleanup(); show("home"); toast(msg); }
      break;
    }
    case "peer-joined": updateCount(m.n); await offer(m.id); break;
    case "peer-left": closePeer(m.id); updateCount(m.n); break;
    case "signal": S.role === "master" ? await masterSignal(m.from, m.data) : await listenerSignal(m.data); break;
    case "state": applyRoom(m.state, m.action); break;
    case "master-status": S.masterOnline = m.online; if (!m.online) setStatus("RECONNECTING"); else if (S.pc && S.pc.connectionState === "connected") setStatus("CONNECTED"); updateUI(); break;
    case "room-closed": if (S.role === "listener") endRoom("Room closed", "The Master has ended this room."); break;
  }
}
function updateCount(n) { $("#count").textContent = n + (n === 1 ? " listener" : " listeners"); }

/* ---------- WebRTC: master side (one RTCPeerConnection per listener) ---------- */
async function offer(id) {
  closePeer(id);
  const pc = new RTCPeerConnection({ iceServers: S.ice }); S.pcs.set(id, pc);
  for (const t of S.dest.stream.getAudioTracks()) pc.addTrack(t, S.dest.stream);
  pc.onicecandidate = (e) => { if (e.candidate) send({ type: "signal", to: id, data: { candidate: e.candidate.toJSON() } }); };
  pc.onconnectionstatechange = () => { if (["closed", "failed"].includes(pc.connectionState) && S.pcs.get(id) === pc) { pc.close(); S.pcs.delete(id); } };
  await pc.setLocalDescription(await pc.createOffer());
  send({ type: "signal", to: id, data: { sdp: pc.localDescription.toJSON() } });
}
async function masterSignal(id, d) {
  const pc = S.pcs.get(id); if (!pc) return;
  try { if (d.sdp) await pc.setRemoteDescription(d.sdp); else if (d.candidate) await pc.addIceCandidate(d.candidate); } catch (e) { console.warn("signal", e); }
}
function closePeer(id) {
  if (S.role === "master") { const pc = S.pcs.get(id); if (pc) { pc.onicecandidate = pc.onconnectionstatechange = null; pc.close(); S.pcs.delete(id); } }
  else if (S.pc) { S.pc.onicecandidate = S.pc.onconnectionstatechange = S.pc.ontrack = null; S.pc.close(); S.pc = null; }
}

/* ---------- WebRTC: listener side ---------- */
async function listenerSignal(d) {
  if (d.sdp) {
    closePeer();
    const pc = (S.pc = new RTCPeerConnection({ iceServers: S.ice }));
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: "signal", to: "master", data: { candidate: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => attachStream(e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (S.pc !== pc) return;
      if (st === "connected") { setStatus("CONNECTED"); S.resynced = 0; }
      else if (st === "connecting") setStatus("CONNECTING");
      else if (st === "disconnected") { setStatus("RECONNECTING"); setTimeout(() => { if (S.pc === pc && pc.connectionState !== "connected") send({ type: "resync" }); }, 4000); }
      else if (st === "failed") { if (S.resynced++ < 3) { setStatus("RECONNECTING"); send({ type: "resync" }); } else { setStatus("CONNECTION FAILED"); toast("WebRTC connection failed. A TURN server may be needed on this network."); } }
    };
    await pc.setRemoteDescription(d.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    send({ type: "signal", to: "master", data: { sdp: pc.localDescription.toJSON() } });
  } else if (d.candidate && S.pc) { try { await S.pc.addIceCandidate(d.candidate); } catch (e) { console.warn(e); } }
}
async function attachStream(stream) {
  if (S.remote) S.remote.srcObject = null;
  if (S.vsrc) try { S.vsrc.disconnect(); } catch {}
  S.remote = new Audio(); S.remote.srcObject = stream; S.remote.autoplay = true;
  S.vsrc = S.ctx.createMediaStreamSource(stream); S.vsrc.connect(S.analyser); // analyser only: real visualizer on received audio
  await tryPlay();
}
async function tryPlay() {
  if (S.room.src === "youtube") { $("#tap").hidden = true; ytFollow(S.room, "tap"); return syncViz(); }
  try { await S.ctx.resume(); await S.remote.play(); $("#tap").hidden = S.ctx.state !== "running"; }
  catch { $("#tap").hidden = false; }
  syncViz();
}

/* ---------- room state ---------- */
function computePos() {
  const r = S.room;
  if (S.role === "master" && S.audio) return curT();
  if (!r.isPlaying) return r.masterPosition;
  const p = r.masterPosition + (Date.now() + S.offset - r.lastStateUpdate) / 1000;
  return r.duration ? Math.min(r.duration, p) : p;
}
function applyRoom(state, action) {
  S.room = state;
  if (S.role === "listener") {
    ytFollow(state, action);
    if (S.remote && S.masterOnline) tryPlay();
    if (action === "volume" || action === "welcome") $("#lvol").textContent = Math.round(state.volume * 100) + "%";
  }
  updateUI();
}
function pushState(action) {
  if (S.role !== "master" || !S.audio) return;
  const r = S.room, yt = isYT();
  send({ type: "state", action, songName: r.songName, fileName: r.fileName, src: S.src, vid: yt ? Y.id : "", duration: durT(), isPlaying: isPl(), masterPosition: curT(), volume: S.gain.gain.value });
}
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function updateUI() {
  const r = S.room, m = S.role === "master";
  const has = !!r.songName;
  $("#title").textContent = has ? r.songName : m ? "No song selected" : "Waiting for Master";
  $("#fileName").textContent = has ? r.fileName : "";
  $("#wait").textContent = !m && !has ? "WAITING FOR MASTER" : "";
  const playing = m ? !!S.audio && isPl() : r.isPlaying;
  $("#pstate").textContent = has ? (playing ? "Playing" : "Paused") : "";
  $("#play").textContent = playing ? "❚❚" : "▶";
  $("#art").classList.toggle("on", playing);
  $("#srcTag").textContent = has ? (r.src === "youtube" ? "YouTube · ambient visuals (not audio analysis)" : "LOCAL AUDIO") : "";
  if (has && r.poster) { $("#art").style.setProperty("--art", `url(${r.poster}) center/cover`); $("#art").style.setProperty("--glow", "rgba(143,125,255,.5)"); }
  else if (has) { const h = hue(r.songName); $("#art").style.setProperty("--art", `linear-gradient(135deg,hsl(${h} 80% 60%),hsl(${(h + 70) % 360} 80% 55%))`); $("#art").style.setProperty("--glow", `hsla(${h},90%,60%,.5)`); }
  $("#mconn").textContent = S.masterOnline ? "Master connected" : "Master reconnecting…";
  const d = r.duration || 0; $("#dur").textContent = fmt(d);
  syncViz();
}
function tick() {
  if (!S.active || document.hidden) return;
  const p = computePos(), d = S.role === "master" ? durT() : S.room.duration || 0;
  if (S.role === "master" && isPl() && (S.n = (S.n || 0) + 1) % 40 === 0) pushState("tick"); // light periodic sync every ~10s
  $("#dur").textContent = fmt(d); $("#cur").textContent = fmt(p);
  if (!S.dragging) $("#seek").value = d ? Math.round((p / d) * 1000) : 0;
}

/* ---------- visualizer engine (17 modes, one canvas, one rAF loop) ---------- */
const V = { raf: 0, last: 0, pt: 0, f: null, t: null, mode: -1, s: {}, T: 0, amb: false, cd: 0, z: 0, rt: 0, tg: 0, rh: Math.random() * 360, h1: 260, h2: 170, b: { bass: 0, mid: 0, treb: 0, en: 0 } };
const TAU = 6.2832, RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hueOf = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
function hues() { V.h1 = hueOf(cfg.c1); V.h2 = hueOf(cfg.c2); }
function col(i, n, a = 1) {
  const u = n > 1 ? i / (n - 1) : 0; let h;
  switch (cfg.cm) {
    case "single": h = V.h1; break;
    case "dual": h = u < .5 ? V.h1 : V.h2; break;
    case "custom": h = V.h1 + (((V.h2 - V.h1 + 540) % 360) - 180) * u; break;
    case "multi": h = u * 300 + 20; break;
    case "random": h = V.rh + u * 90; break;
    default: h = V.T * 40 + u * 120; // RGB: smooth continuous hue drift
  }
  return `hsla(${((h % 360) + 360) % 360 | 0},${Math.min(100, 85 * cfg.sat) | 0}%,${Math.min(80, 56 * cfg.bright) | 0}%,${Math.max(0, Math.min(1, a))})`;
}
const pool = (k, n, mk) => V.s[k] || (V.s[k] = Array.from({ length: n }, mk));
const N = (n) => Math.max(8, Math.round(n * cfg.pamt * (cfg.lite ? .45 : 1)));
const L = (x) => { // spectrum level 0..1 at fraction x of the (log-ish) spectrum, with per-band response
  if (V.amb) return Math.max(0, V.b.en * (.6 + .4 * Math.sin(x * 14 + V.T * 2.5)));
  const i = Math.min(V.f.length - 1, 1 + ((x * x * 380) | 0)), r = x < .15 ? cfg.bassR : x < .55 ? cfg.midR : cfg.trebR;
  return Math.min(1, (V.f[i] / 255) * cfg.sens * cfg.intensity * r);
};
const MODES = [
  ["Liquid Wave", (g, w, h, T, B) => { for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w + 1; x += w / 40) g.lineTo(x, h * (.55 + k * .09) - Math.sin(x / w * (3 + k) + T * (.6 + k * .25)) * h * .07 * (1 + B.bass * 2.2) - Math.sin(x / w * 8 - T * 1.4) * h * .025 * (.5 + B.mid * 2)); g.lineTo(w, h); g.fillStyle = col(k, 4, .32); g.fill(); } }],
  ["Spectrum Bars", (g, w, h) => { const n = cfg.lite ? 32 : 64, bw = w / n; for (let i = 0; i < n; i++) { const l = Math.max(.02, L(i / n)); g.fillStyle = col(i, n, .85); g.fillRect(i * bw + bw * .12, h - l * h * .85, bw * .76, l * h * .85); g.fillRect(i * bw + bw * .12, 0, bw * .76, l * h * .12); } }],
  ["Aurora", (g, w, h, T, B) => { g.lineCap = "round"; for (let k = 0; k < 6; k++) { const x0 = w * (k + .5) / 6, gr = g.createLinearGradient(0, 0, 0, h * .8); gr.addColorStop(0, col(k, 6, 0)); gr.addColorStop(.5, col(k, 6, .28 + B.mid * .4)); gr.addColorStop(1, col(k, 6, 0)); g.strokeStyle = gr; g.lineWidth = w / 6 * (.7 + B.bass * .8); g.beginPath(); for (let y = 0; y <= h * .8; y += h / 14) { const x = x0 + Math.sin(y / h * 4 + T * .7 + k * 1.7) * w * .05 * (1 + B.bass * 2); y ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } }],
  ["Particle Flow", (g, w, h, T, B) => { const P = pool("pf", N(120), () => ({ x: Math.random(), y: Math.random() })); for (let i = 0; i < P.length; i++) { const p = P[i], a = Math.sin(p.x * 5 + T * .5) * Math.cos(p.y * 4 - T * .4) * TAU, sp = .002 + B.en * .012; g.strokeStyle = col(i, P.length, .8); g.lineWidth = 1.5 + B.treb * 3; g.beginPath(); g.moveTo(p.x * w, p.y * h); p.x += Math.cos(a) * sp; p.y += Math.sin(a) * sp; g.lineTo(p.x * w, p.y * h); g.stroke(); if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) { p.x = Math.random(); p.y = Math.random(); } } }],
  ["Neon Rings", (g, w, h, T, B) => { const cx = w / 2, cy = h / 2, m = Math.min(w, h); for (let i = 0; i < 7; i++) { const r = m * (.08 + i * .06) * (1 + B.bass * .35 * (1 - i / 9)), s = T * (i % 2 ? 1 : -1) * .4 + i; g.strokeStyle = col(i, 7, .9); g.lineWidth = 2 + L(i / 7) * m * .03; g.beginPath(); g.arc(cx, cy, r, s, s + TAU * (.55 + .4 * L(i / 7))); g.stroke(); } }],
  ["Hypnotic Spiral", (g, w, h, T, B) => { const cx = w / 2, cy = h / 2, m = Math.max(w, h) * .6; for (let a = 0; a < 3; a++) { g.strokeStyle = col(a, 3, .85); g.lineWidth = 2 + B.bass * 8; g.beginPath(); for (let i = 0; i < 140; i++) { const u = i / 140, ang = u * TAU * 4 + T * (.8 + B.en) + a * TAU / 3, r = u * m * (1 + Math.sin(u * 20 - T * 3) * .06 * B.mid + B.bass * .15), x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } }],
  ["Galaxy", (g, w, h, T, B) => { const cx = w / 2, cy = h / 2, m = Math.min(w, h) * .5, P = pool("gx", N(220), () => ({ r: Math.random(), a: Math.random() * TAU, arm: Math.random() * 3 | 0 })); const gr = g.createRadialGradient(cx, cy, 0, cx, cy, m * .5); gr.addColorStop(0, col(0, 1, .2 + B.bass * .5)); gr.addColorStop(1, col(0, 1, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < P.length; i++) { const p = P[i], ang = p.a + p.arm * TAU / 3 + p.r * 5 + T * .15 * (1 + B.en * 2) / (.3 + p.r), r = p.r * m * (1 + B.bass * .2); g.fillStyle = col(i, P.length, .4 + p.r * .5); g.fillRect(cx + Math.cos(ang) * r * 1.6, cy + Math.sin(ang) * r * .9, 1.5 + B.treb * 3 * (1 - p.r), 2.5); } }],
  ["Electric Pulse", (g, w, h, T, B) => { for (let k = 0; k < 3; k++) { g.strokeStyle = col(k, 3, .9); g.lineWidth = 1.5 + B.bass * 4; g.beginPath(); for (let i = 0; i <= 40; i++) { const x = w * i / 40, y = h / 2 + (Math.random() - .5) * h * (.02 + B.treb * .4) * Math.sin(i / 40 * Math.PI) + Math.sin(T * 3 + i * .4 + k) * h * .05 * B.mid; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } if (B.bass > .6) { g.fillStyle = col(0, 1, (B.bass - .6) * .3); g.fillRect(0, 0, w, h); } }],
  ["Fire Energy", (g, w, h, T) => { const n = cfg.lite ? 24 : 48, bw = w / n; for (let i = 0; i < n; i++) { const l = Math.max(.05, L(i / n)) * .75 + Math.sin(T * 6 + i) * .03, hh = l * h, gr = g.createLinearGradient(0, h, 0, h - hh); gr.addColorStop(0, `hsla(${8 + l * 40 | 0},100%,${Math.min(70, 50 * cfg.bright) | 0}%,.9)`); gr.addColorStop(1, "hsla(50,100%,55%,0)"); g.fillStyle = gr; g.beginPath(); g.moveTo(i * bw, h); g.quadraticCurveTo(i * bw + bw * .5 + Math.sin(T * 4 + i) * bw * .4, h - hh, i * bw + bw, h); g.fill(); } }],
  ["Ripple", (g, w, h, T, B) => { const R = pool("rp", 14, () => ({ r: -1, a: 0, x: 0, y: 0 })); V.cd--; if (B.bass > .5 && V.cd <= 0) { const q = R.find((x) => x.r < 0); if (q) { q.r = 0; q.a = 1; q.x = w * (.3 + Math.random() * .4); q.y = h * (.3 + Math.random() * .4); } V.cd = 10; } for (const q of R) { if (q.r < 0) continue; q.r += w * .006 * (1 + B.en * 2); q.a -= .012; if (q.a <= 0) { q.r = -1; continue; } g.strokeStyle = col(q.r / w * 10, 10, q.a); g.lineWidth = 2 + q.a * 6; g.beginPath(); g.arc(q.x, q.y, q.r, 0, TAU); g.stroke(); } }],
  ["Crystal", (g, w, h, T) => { const cx = w / 2, cy = h / 2, m = Math.min(w, h) * .5, n = 12; for (let i = 0; i < n; i++) { const a0 = i / n * TAU + T * .2, a1 = (i + 1) / n * TAU + T * .2, r0 = m * (.25 + L(i / n) * .75), r1 = m * (.25 + L((i + 1) / n) * .75), am = (a0 + a1) / 2; g.fillStyle = col(i, n, .35); g.strokeStyle = col(i, n, .9); g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0); g.lineTo(cx + Math.cos(am) * (r0 + r1) * .62, cy + Math.sin(am) * (r0 + r1) * .62); g.lineTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1); g.closePath(); g.fill(); g.stroke(); } }],
  ["DNA Wave", (g, w, h, T, B) => { const n = cfg.lite ? 28 : 48, amp = h * (.12 + B.bass * .15); for (let i = 0; i < n; i++) { const x = w * (i + .5) / n, p = i * .45 + T * 1.6, y1 = h / 2 + Math.sin(p) * amp, y2 = h / 2 - Math.sin(p) * amp, r = Math.max(1, 3 + Math.cos(p) * 2 + L(i / n) * 10); g.strokeStyle = col(i, n, .35); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y2); g.stroke(); g.fillStyle = col(i, n, .95); g.beginPath(); g.arc(x, y1, r, 0, TAU); g.fill(); g.fillStyle = col(i + n / 2, n, .95); g.beginPath(); g.arc(x, y2, r, 0, TAU); g.fill(); } }],
  ["Meteor", (g, w, h, T, B) => { const P = pool("mt", N(16), () => ({ x: 0, y: 0, v: 0, on: 0 })); V.cd--; if (V.cd <= 0 && B.en > .25) { const q = P.find((x) => !x.on); if (q) { q.on = 1; q.x = Math.random() * w * 1.3; q.y = -20; q.v = (.008 + B.bass * .02) * h; V.cd = Math.max(3, 12 - B.en * 10); } } g.lineCap = "round"; for (const q of P) { if (!q.on) continue; q.x -= q.v * .6; q.y += q.v; if (q.y > h + 40 || q.x < -40) { q.on = 0; continue; } const gr = g.createLinearGradient(q.x, q.y, q.x + q.v * 8, q.y - q.v * 13); gr.addColorStop(0, col(q.y / h * 5, 5, 1)); gr.addColorStop(1, col(0, 1, 0)); g.strokeStyle = gr; g.lineWidth = 2 + B.treb * 4; g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x + q.v * 8, q.y - q.v * 13); g.stroke(); } }],
  ["RGB Tunnel", (g, w, h, T, B) => { V.z = (V.z + .006 + B.en * .03) % 1; const cx = w / 2 + Math.sin(T * .6) * w * .05, cy = h / 2 + Math.cos(T * .5) * h * .05; for (let i = 12; i >= 0; i--) { const u = (i + V.z) / 13, s = u * u * Math.max(w, h) * 1.1 * (1 + B.bass * .15 * u); g.strokeStyle = col(i, 13, u * .9); g.lineWidth = 1 + u * 4; g.save(); g.translate(cx, cy); g.rotate(T * .1 * (i % 2 ? 1 : -1) * u); g.strokeRect(-s / 2, -s / 2, s, s); g.restore(); } }],
  ["Liquid Bubbles", (g, w, h, T, B) => { const P = pool("bb", N(28), () => ({ x: Math.random(), y: Math.random(), r: .02 + Math.random() * .05, v: .001 + Math.random() * .003, p: Math.random() * 9 })), m = Math.min(w, h); for (let i = 0; i < P.length; i++) { const p = P[i]; p.y -= p.v * (1 + B.en * 4); if (p.y < -.1) { p.y = 1.1; p.x = Math.random(); } g.fillStyle = col(i, P.length, .16); g.strokeStyle = col(i, P.length, .7); g.lineWidth = 2; g.beginPath(); g.arc(p.x * w + Math.sin(T + p.p) * m * .03, p.y * h, m * p.r * (1 + B.mid * .9 + Math.sin(T * 2 + p.p) * .08), 0, TAU); g.fill(); g.stroke(); } }],
  ["Neural Network", (g, w, h, T, B) => { const P = pool("nn", N(38), () => ({ x: Math.random(), y: Math.random(), dx: (Math.random() - .5) * .0015, dy: (Math.random() - .5) * .0015 })), m = Math.min(w, h) * .3; for (const p of P) { p.x = (p.x + p.dx * (1 + B.en * 4) + 1) % 1; p.y = (p.y + p.dy * (1 + B.en * 4) + 1) % 1; } g.lineWidth = 1; for (let i = 0; i < P.length; i++) { const a = P[i]; for (let j = i + 1; j < P.length; j++) { const b = P[j], d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h); if (d < m) { g.strokeStyle = col(i, P.length, (1 - d / m) * (.25 + B.en)); g.beginPath(); g.moveTo(a.x * w, a.y * h); g.lineTo(b.x * w, b.y * h); g.stroke(); } } g.fillStyle = col(i, P.length, .9); g.beginPath(); g.arc(a.x * w, a.y * h, 2 + B.mid * 5, 0, TAU); g.fill(); } }],
  ["Cosmic Field", (g, w, h, T, B) => { const cx = w / 2, cy = h / 2, P = pool("cf", N(150), () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() })), gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * .5); gr.addColorStop(0, col(0, 1, .15 + B.bass * .4)); gr.addColorStop(1, col(0, 1, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < P.length; i++) { const p = P[i], z0 = p.z; p.z -= .004 + B.en * .02; if (p.z <= .02) { p.x = Math.random() * 2 - 1; p.y = Math.random() * 2 - 1; p.z = 1; continue; } g.strokeStyle = col(i, P.length, 1 - p.z); g.lineWidth = 1 + (1 - p.z) * 2; g.beginPath(); g.moveTo(cx + p.x / z0 * w * .2, cy + p.y / z0 * w * .2); g.lineTo(cx + p.x / p.z * w * .2, cy + p.y / p.z * w * .2); g.stroke(); } }],
];
const isAmb = () => (S.role === "master" ? S.src : S.room.src) === "youtube";
function vizWanted() {
  const playing = S.role === "master" ? !!S.audio && isPl() : S.room.isPlaying && (S.room.src === "youtube" || !!S.remote);
  return S.active && cfg.vis && playing && !document.hidden && !$("#playerScr").hidden;
}
function syncViz() {
  if (vizWanted()) { if (!V.raf) V.raf = requestAnimationFrame(drawViz); }
  else if (V.raf || S.active) { cancelAnimationFrame(V.raf); V.raf = 0; const c = $("#viz"); c.getContext("2d").clearRect(0, 0, c.width, c.height); }
}
function bands(amb) {
  const B = V.b; let bs, md, tr;
  if (amb) { bs = .35 + .25 * Math.sin(V.T * 2.2); md = .3 + .2 * Math.sin(V.T * 1.3 + 1); tr = .25 + .15 * Math.sin(V.T * 3.1 + 2); } // YouTube: playback-driven ambient motion, NOT audio analysis
  else { const a = S.analyser; a.getByteFrequencyData(V.f); a.getByteTimeDomainData(V.t); const avg = (x, y) => { let s = 0; for (let i = x; i < y; i++) s += V.f[i]; return s / (y - x) / 255; }; bs = avg(1, 9); md = avg(9, 90); tr = avg(90, 400); }
  const k = cfg.sens * cfg.intensity, sm = Math.max(.08, 1 - cfg.smooth);
  B.bass += (Math.min(1, bs * k * cfg.bassR) - B.bass) * sm; B.mid += (Math.min(1, md * k * cfg.midR) - B.mid) * sm; B.treb += (Math.min(1, tr * k * cfg.trebR) - B.treb) * sm;
  B.en = (B.bass + B.mid + B.treb) / 3;
}
function drawViz(ts) {
  V.raf = 0; if (!vizWanted()) return syncViz();
  V.raf = requestAnimationFrame(drawViz);
  const fps = cfg.perf || cfg.lite ? 30 : +cfg.fps || 60;
  if (ts - V.last < 1000 / fps - 3) return; V.last = ts;
  const dt = Math.min(.1, (ts - (V.pt || ts)) / 1000); V.pt = ts; V.T += dt * cfg.speed * (RM ? .4 : 1);
  if (ts - V.rt > 6000) { V.rt = ts; V.tg = Math.random() * 360; } V.rh += (((V.tg - V.rh + 540) % 360) - 180) * .02; // random colour mode eases between hues
  const c = $("#viz"), dpr = Math.min(devicePixelRatio || 1, cfg.lite ? 1 : +cfg.q || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext("2d"), a = S.analyser; V.amb = isAmb();
  if (!V.f || V.f.length !== a.frequencyBinCount) { V.f = new Uint8Array(a.frequencyBinCount); V.t = new Uint8Array(a.fftSize); }
  const mi = Math.min(MODES.length - 1, +cfg.style || 0); if (V.mode !== mi) { V.mode = mi; V.s = {}; g.clearRect(0, 0, w, h); }
  bands(V.amb);
  g.globalCompositeOperation = "destination-out"; g.fillStyle = `rgba(0,0,0,${cfg.trails ? .16 : .6})`; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = cfg.bloom && !cfg.lite ? "lighter" : "source-over";
  g.shadowBlur = cfg.bloom && !cfg.lite && !cfg.perf ? cfg.vglow * 22 * dpr : 0; g.shadowColor = col(0, 1, .9);
  if (cfg.pulse) { g.fillStyle = col(0, 1, V.b.bass * .1); g.fillRect(0, 0, w, h); }
  g.lineJoin = "round"; MODES[mi][1](g, w, h, V.T, V.b);
}

/* ---------- master controls (local file or YouTube) ---------- */
const yp = () => (Y.p && Y.p.getPlayerState ? Y.p : null);
const isYT = () => S.src === "youtube";
const curT = () => (isYT() ? (yp() ? yp().getCurrentTime() : 0) : S.audio.currentTime) || 0;
const durT = () => (isYT() ? (yp() ? yp().getDuration() : 0) : S.audio.duration) || 0;
const isPl = () => (isYT() ? !!yp() && yp().getPlayerState() === 1 : !S.audio.paused && !S.audio.ended);
const clampT = (t) => Math.max(0, Math.min(durT() || 1e6, t));
async function play() {
  if (isYT()) { if (!yp()) return toast("Paste a YouTube link first"); yp().playVideo(); return; }
  if (!S.audio.src) return toast("Select a song first");
  await S.ctx.resume(); await S.audio.play(); pushState("play"); updateUI();
}
function pause() { if (isYT()) { yp() && yp().pauseVideo(); return; } S.audio.pause(); pushState("pause"); updateUI(); }
function stopPlay() { if (isYT()) { if (yp()) { yp().seekTo(0, true); yp().pauseVideo(); } } else { S.audio.pause(); S.audio.currentTime = 0; } pushState("stop"); updateUI(); }
function seekTo(t) {
  if (isYT()) { if (!yp()) return; yp().seekTo(clampT(t), true); setTimeout(() => pushState("seek"), 250); return; }
  if (!S.audio.src) return; S.audio.currentTime = clampT(t); pushState("seek");
}
let volT = 0;
function setVol(v) {
  S.gain.gain.value = v; $("#volLbl").textContent = Math.round(v * 100) + "%";
  if (isYT() && yp()) yp().setVolume(Math.min(100, v * 100)); // YouTube player volume caps at 100%
  clearTimeout(volT); volT = setTimeout(() => pushState("volume"), 80); // local: Web Audio gain 0-200%, baked into the WebRTC stream
}
function pickFile(f) {
  if (!f) return;
  if (yp()) yp().pauseVideo();
  if (S.url) URL.revokeObjectURL(S.url);
  S.url = URL.createObjectURL(f); // stays local, never uploaded
  S.src = "local"; document.body.classList.remove("yt"); $("#ytBox").hidden = true;
  Object.assign(S.room, { src: "local", vid: "", poster: "", songName: f.name.replace(/\.[^.]+$/, ""), fileName: f.name });
  S.audio.src = S.url; S.audio.load(); updateUI();
}
const loadYT = safe(async () => {
  const id = ytId($("#ytIn").value);
  if (!id) return toast("That doesn't look like a valid YouTube link");
  if (S.audio && !S.audio.paused) S.audio.pause();
  S.src = "youtube"; document.body.classList.add("yt");
  Object.assign(S.room, { src: "youtube", vid: id, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, songName: "", fileName: "YouTube", duration: 0 });
  const had = !!Y.p;
  try { await ytEnsure(id); } catch { return toast("Could not load the YouTube player. Check your connection."); }
  $("#ytBox").hidden = false; if (had && Y.id !== id) Y.p.cueVideoById(id);
  Y.id = id; updateUI();
});

/* ---------- YouTube (official IFrame Player API only; no audio extraction) ---------- */
const Y = { p: null, ready: null, id: "" };
const YERR = { 2: "Invalid YouTube video.", 5: "The YouTube player hit an error. Try again.", 100: "This video is unavailable, private or deleted.", 101: "The owner disabled embedding for this video.", 150: "The owner disabled embedding for this video." };
function ytLoadApi() {
  return Y.ready || (Y.ready = new Promise((res, rej) => { window.onYouTubeIframeAPIReady = res; const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.onerror = () => { Y.ready = null; rej(new Error("yt")); }; document.head.appendChild(s); }));
}
function ytId(u) {
  try {
    const x = new URL(String(u).trim()); let id = "";
    if (x.hostname === "youtu.be") id = x.pathname.slice(1);
    else if (/(^|\.)youtube\.com$/.test(x.hostname)) id = x.searchParams.get("v") || ((x.pathname.match(/^\/(embed|shorts|live)\/([\w-]{11})/) || [])[2]);
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}
async function ytEnsure(id) {
  await ytLoadApi(); if (Y.p) return;
  $("#ytBox").hidden = false; $("#ytBox").innerHTML = '<div id="ytp"></div>';
  await new Promise((res) => { Y.p = new window.YT.Player("ytp", { width: "100%", height: "100%", videoId: id, playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1 }, events: { onReady: () => res(), onStateChange: ytState, onError: (e) => toast(YERR[e.data] || "YouTube playback error"), onAutoplayBlocked: () => { if (S.role === "listener") $("#tap").hidden = false; } } }); });
}
function ytState(e) {
  if (S.role === "master") {
    const d = Y.p.getVideoData && Y.p.getVideoData();
    if (d && d.title && S.room.songName !== d.title) { S.room.songName = d.title; pushState("song"); }
    if (e.data === 1) pushState("play"); else if (e.data === 2 || e.data === 0) pushState("pause");
  } else if (e.data === 1) $("#tap").hidden = true;
  updateUI();
}
function ytFollow(st, action) { // listener: follow the Master's authoritative state
  if (S.role !== "listener") return;
  const yt = st.src === "youtube" && !!st.vid; document.body.classList.toggle("yt", yt);
  if (!yt) { if (yp()) yp().pauseVideo(); return $("#ytBox").hidden = true; }
  ytEnsure(st.vid).then(() => {
    const p = computePos(), q = yp(); if (!q) return; $("#ytBox").hidden = false;
    if (Y.id !== st.vid) { Y.id = st.vid; st.isPlaying ? q.loadVideoById({ videoId: st.vid, startSeconds: p }) : q.cueVideoById({ videoId: st.vid, startSeconds: p }); }
    else { if (action === "seek" || action === "tap" || Math.abs(q.getCurrentTime() - p) > 1.5) q.seekTo(p, true); st.isPlaying ? q.playVideo() : q.pauseVideo(); }
    q.setVolume(Math.min(100, st.volume * 100)); if (action === "stop") { q.seekTo(0, true); q.pauseVideo(); }
  }).catch(() => toast("Could not load the YouTube player. Check your connection."));
}

/* ---------- audio information: only real, measured values ---------- */
async function audioInfo() {
  const yt = isAmb(), rows = [["Source", !S.active ? "—" : yt ? "YouTube (official player)" : "Local audio via WebRTC"]];
  if (S.ctx) rows.push(["Sample rate", S.ctx.sampleRate / 1000 + " kHz"]);
  let codec = "Not available", br = "Auto", ch = "Not available";
  if (yt) codec = br = ch = "Not measurable (YouTube)";
  else { const pc = S.role === "master" ? [...S.pcs.values()][0] : S.pc; if (pc) { try { (await pc.getStats()).forEach((r) => {
    if (r.type === "codec" && r.mimeType && r.mimeType.startsWith("audio")) { codec = r.mimeType.split("/")[1]; if (r.channels) ch = r.channels > 1 ? "Stereo" : "Mono"; }
    if (r.type === (S.role === "master" ? "outbound-rtp" : "inbound-rtp") && r.kind === "audio") { const b = r.bytesSent ?? r.bytesReceived, n = performance.now(); if (S.lb && n > S.lb.t) br = Math.round(((b - S.lb.b) * 8) / (n - S.lb.t)) + " kbps"; S.lb = { b, t: n }; }
  }); } catch {} } }
  rows.push(["Codec", codec], ["Streaming bitrate", br], ["Channels", ch]);
  $("#ainfo").textContent = rows.map((r) => r[0] + ": " + r[1]).join("\n");
}

/* ---------- navigation / lifecycle ---------- */
function cleanup() {
  S.closing = true; S.active = false;
  clearInterval(S.hb); clearInterval(S.tick); clearTimeout(volT); clearInterval(infoT);
  if (Y.p) { try { Y.p.destroy(); } catch {} Y.p = null; Y.id = ""; } $("#ytBox").hidden = true; document.body.classList.remove("yt");
  cancelAnimationFrame(V.raf); V.raf = 0;
  try { S.ws && S.ws.close(); } catch {}
  for (const pc of S.pcs.values()) try { pc.close(); } catch {}
  if (S.pc) try { S.pc.close(); } catch {}
  if (S.remote) { S.remote.pause(); S.remote.srcObject = null; }
  if (S.audio) { S.audio.pause(); S.audio.removeAttribute("src"); S.audio.load(); }
  if (S.dest) S.dest.stream.getTracks().forEach((t) => t.stop());
  if (S.url) URL.revokeObjectURL(S.url);
  try { S.ctx && S.ctx.close(); } catch {}
  const c = $("#viz"); c.getContext("2d").clearRect(0, 0, c.width, c.height);
  $("#tap").hidden = true; $("#file").value = "";
  resetState(); loadIce();
}
function endRoom(title, msg) { cleanup(); $("#endTitle").textContent = title; $("#endMsg").textContent = msg; show("endScr"); }
function goHome() {
  if (S.role === "master" && S.active) return $("#cfm").showModal();
  cleanup(); show("home");
}
function enterPlayer(role) {
  S.role = role; S.active = true; S.closing = false; document.body.dataset.role = role;
  $("#roleTag").textContent = role === "master" ? "Master room" : "Listening";
  $("#roomCode").textContent = S.code; $("#vol").value = 100; $("#volLbl").textContent = "100%"; $("#lvol").textContent = "100%";
  $("#seek").disabled = role !== "master";
  setStatus("CONNECTING"); updateCount(0); updateUI(); show("playerScr");
  S.tick = setInterval(safe(tick), 250);
}
function joinScreen(err) { show("joinScr"); $("#joinErr").textContent = err || ""; }
async function loadIce() { try { const r = await fetch("/api/config"); const j = await r.json(); if (Array.isArray(j.iceServers)) S.ice = j.iceServers; } catch {} }

const create = safe(async () => {
  let res;
  try { res = await fetch("/api/create", { method: "POST" }); if (!res.ok) throw 0; res = await res.json(); } catch { return toast("Could not create room"); }
  try { initMasterAudio(); } catch { return toast("This browser does not support Web Audio"); }
  S.code = res.code; S.token = res.token; S.role = "master";
  enterPlayer("master"); connect();
});
const joinRoom = safe(() => {
  const code = $("#code").value.trim();
  if (!/^\d{6}$/.test(code)) return ($("#joinErr").textContent = "Enter the 6-digit code");
  try { makeCtx(); } catch { return toast("This browser does not support Web Audio"); }
  S.code = code; S.role = "listener"; enterPlayer("listener"); connect();
});

function init() {
  bindSettings(); particles(); loadIce();
  document.addEventListener("visibilitychange", safe(() => { particles(); syncViz(); if (!document.hidden && S.ctx && S.ctx.state === "suspended" && S.role === "master") S.ctx.resume(); }));
  addEventListener("resize", safe(() => cfg.parts && particles()));
  $("#intro").addEventListener("click", () => ($("#intro").style.display = "none"));
  setTimeout(() => ($("#intro").style.display = "none"), 3800);
  $("#ytGo").onclick = loadYT; $("#ytIn").addEventListener("keydown", (e) => { if (e.key === "Enter") loadYT(); });
  $("#fsBtn").onclick = safe(() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen()));
  document.addEventListener("fullscreenchange", () => document.body.classList.toggle("fs", !!document.fullscreenElement));
  const q = new URLSearchParams(location.search).get("room"); if (/^\d{6}$/.test(q || "")) { $("#code").value = q; joinScreen(); }
  $("#create").onclick = create;
  $("#join").onclick = () => joinScreen();
  $("#joinGo").onclick = joinRoom;
  $("#code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); $("#joinErr").textContent = ""; });
  $("#code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  $("#homeBtn").onclick = safe(goHome);
  $("#endHome").onclick = () => show("home");
  $("#cfmNo").onclick = () => $("#cfm").close();
  $("#cfmYes").onclick = safe(() => { $("#cfm").close(); send({ type: "close" }); endRoom("Room closed", "You ended this room."); });
  $("#copy").onclick = safe(async () => { try { await navigator.clipboard.writeText(S.code); toast("Code copied"); } catch { toast("Room code: " + S.code); } });
  $("#share").onclick = safe(async () => {
    const data = { title: "SYNCWAVE", text: `Join my SYNCWAVE room with code ${S.code}`, url: `${location.origin}/?room=${S.code}` };
    if (navigator.share) { try { await navigator.share(data); } catch {} } else $("#copy").click();
  });
  $("#pick").onclick = () => $("#file").click();
  $("#file").onchange = safe((e) => pickFile(e.target.files[0]));
  $("#play").onclick = safe(() => (isPl() ? pause() : play()));
  $("#stopBtn").onclick = safe(stopPlay);
  $("#back").onclick = safe(() => seekTo(curT() - 10));
  $("#fwd").onclick = safe(() => seekTo(curT() + 10));
  $("#seek").addEventListener("input", () => { S.dragging = true; const d = S.role === "master" ? durT() : 0; $("#cur").textContent = fmt((+$("#seek").value / 1000) * d); });
  $("#seek").addEventListener("change", safe(() => { S.dragging = false; if (S.role === "master") seekTo((+$("#seek").value / 1000) * durT()); }));
  $("#vol").addEventListener("input", safe((e) => S.role === "master" && setVol(e.target.value / 100)));
  $("#stopListen").onclick = safe(() => { cleanup(); $("#endTitle").textContent = "Listening stopped"; $("#endMsg").textContent = "You left the room. Other listeners are not affected."; show("endScr"); });
  $("#tap").onclick = safe(() => tryPlay());
  addEventListener("beforeunload", (e) => { if (S.role === "master" && S.active) { e.preventDefault(); e.returnValue = ""; } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
window.addEventListener("error", () => toast("Something went wrong"));
window.addEventListener("unhandledrejection", (e) => console.error(e.reason));
init();
