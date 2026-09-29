// Generates the soundtrack for the launch video: an original, deterministic 30 s bed plus small
// UI sound effects synced to video/timings.json. Pure Node, no samples, no third-party audio:
// the result is ours to license under the project's MIT licence (see CREDITS.md). The owner may
// swap docs/launch/media/track.mp3 for any other file; render.sh only regenerates it when missing
// (or with --force).
//
//   node audio/make-track.mjs [--out <file.mp3>] [--bpm 96]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const OUT = resolve(opt("out", resolve(here, "../../../docs/launch/media/track.mp3")));
const BPM = Number(opt("bpm", 96));
const T = JSON.parse(readFileSync(resolve(here, "../video/timings.json"), "utf8"));
const DUR = T.duration;
const SR = 44100;
const N = Math.ceil(DUR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const beat = 60 / BPM;

// seeded noise (mulberry32)
let seed = 0x5eed5;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Mix a mono voice into the stereo bed at time t with pan p (-1..1). */
function put(t, buf, gain = 1, p = 0) {
  const s0 = Math.floor(t * SR);
  const gl = gain * Math.cos(((p + 1) * Math.PI) / 4), gr = gain * Math.sin(((p + 1) * Math.PI) / 4);
  for (let i = 0; i < buf.length; i++) {
    const k = s0 + i;
    if (k < 0 || k >= N) continue;
    L[k] += buf[i] * gl; R[k] += buf[i] * gr;
  }
}

function lowpass(buf, fc) { const a = Math.exp((-2 * Math.PI * fc) / SR); let y = 0; for (let i = 0; i < buf.length; i++) { y = (1 - a) * buf[i] + a * y; buf[i] = y; } return buf; }
function highpass(buf, fc) { const a = Math.exp((-2 * Math.PI * fc) / SR); let y = 0, x1 = 0; for (let i = 0; i < buf.length; i++) { y = a * (y + buf[i] - x1); x1 = buf[i]; buf[i] = y; } return buf; }

/** Soft pluck: sine + harmonics with a fast exponential decay. */
function pluck(m, dur = 0.9, bright = 0.35) {
  const f = hz(m), n = Math.floor(dur * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.exp(-t * 5.2) * clamp01(t / 0.004);
    b[i] = env * (Math.sin(2 * Math.PI * f * t) + bright * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 9) + 0.12 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 14));
  }
  return b;
}
/** Warm pad note: detuned triangle-ish stack, slow attack, lowpassed. */
function pad(m, dur) {
  const f = hz(m), n = Math.floor(dur * SR), b = new Float32Array(n);
  const det = [0.996, 1, 1.004];
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = clamp01(t / 1.4) * clamp01((dur - t) / 1.8);
    let v = 0;
    for (const d of det) { const ph = (f * d * t) % 1; v += 2 * Math.abs(2 * ph - 1) - 1; }
    b[i] = env * v * 0.33;
  }
  return lowpass(b, 900);
}
function bass(m, dur = 1.1) {
  const f = hz(m), n = Math.floor(dur * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.4) * clamp01(t / 0.01) * 0.9; }
  return b;
}
function kick() {
  const n = Math.floor(0.32 * SR), b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 46 + 90 * Math.exp(-t * 28); ph += (2 * Math.PI * f) / SR; b[i] = Math.sin(ph) * Math.exp(-t * 11); }
  return b;
}
function hat(open = false) {
  const n = Math.floor((open ? 0.22 : 0.06) * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = (rnd() * 2 - 1) * Math.exp((-i / SR) * (open ? 16 : 70));
  return highpass(b, 6500);
}
function click(hi = 1) {
  const n = Math.floor(0.05 * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = ((rnd() * 2 - 1) * 0.5 + Math.sin(2 * Math.PI * 1500 * hi * t)) * Math.exp(-t * 110); }
  return highpass(b, 700);
}
function pop(f0 = 520) {
  const n = Math.floor(0.22 * SR), b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = f0 + 700 * (1 - Math.exp(-t * 30)); ph += (2 * Math.PI * f) / SR; b[i] = Math.sin(ph) * Math.exp(-t * 15) * clamp01(t / 0.003); }
  return b;
}
function whoosh(dur = 0.7) {
  const n = Math.floor(dur * SR), b = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, u = t / dur, fc = 300 + 4200 * Math.sin(Math.PI * u) ** 2;
    const a = Math.exp((-2 * Math.PI * fc) / SR);
    y = (1 - a) * (rnd() * 2 - 1) + a * y;
    b[i] = y * Math.sin(Math.PI * u) ** 1.6 * 3.2;
  }
  return b;
}
function bell(m, dur = 3) {
  const f = hz(m), n = Math.floor(dur * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; b[i] = (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.756 * t) * Math.exp(-t * 3) + 0.25 * Math.sin(2 * Math.PI * f * 5.404 * t) * Math.exp(-t * 6)) * Math.exp(-t * 1.5) * clamp01(t / 0.003); }
  return b;
}

// ---- harmony: C major, one chord per 5 s (2 bars of 4 at 96 bpm ~ 5 s) -----------------------
const chords = [
  { root: 48, tones: [60, 64, 67, 71] },  // Cmaj7
  { root: 45, tones: [57, 60, 64, 67] },  // Am7
  { root: 41, tones: [57, 60, 65, 69] },  // Fmaj7
  { root: 43, tones: [59, 62, 67, 71] },  // G6-ish
  { root: 45, tones: [57, 60, 64, 67] },  // Am7
  { root: 48, tones: [60, 64, 67, 72] },  // C (home)
];
const seg = DUR / chords.length;

chords.forEach((c, ci) => {
  const t0 = ci * seg;
  // pad (chord tones an octave down + root)
  for (const m of [c.root + 12, ...c.tones.slice(0, 3)]) put(t0 - 0.2, pad(m - 12, seg + 0.6), 0.16, (m % 5) / 8 - 0.3);
  // bass from second scene on
  if (t0 >= 4.5) for (let b = 0; b < seg / beat; b += 2) put(t0 + b * beat, bass(c.root - 12), 0.30, 0);
  // eighth-note arpeggio: soft from 4.6, fuller from 10.6, gentler in the dark scene
  if (t0 + seg > 4.6) {
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let e = 0; e < Math.floor(seg / (beat / 2)); e++) {
      const t = t0 + e * (beat / 2);
      if (t < 4.6 || t > 27.6) continue;
      const vol = t < 10.6 ? 0.10 : t < 17.6 ? 0.17 : t < 24.6 ? 0.12 : 0.15;
      put(t, pluck(c.tones[pattern[e % 8]] + (t >= 17.6 && t < 24.6 ? -12 : 0), 0.9), vol, ((e % 4) - 1.5) * 0.25);
    }
  }
});
// pulse: light kick and hats through the guide scene and the local scene
for (let t = 10.6; t < 27.6; t += beat) {
  if (t >= 17.6 && t < 24.6) { if (Math.round((t - 17.6) / beat) % 2 === 0) put(t, kick(), 0.22, 0); }
  else put(t, kick(), 0.34, 0);
  put(t + beat / 2, hat(false), 0.06, 0.3);
}
// sfx from timings.json
for (const t of T.sfx.click) put(t, click(1), 0.35, 0.05);
for (const t of T.sfx.flag) put(t, pop(600), 0.16, 0.1);
for (const t of T.sfx.whoosh) put(t - 0.1, whoosh(0.7), 0.10, 0);
for (const t of T.sfx.pop) put(t, pop(420), 0.2, 0);
for (const t of T.sfx.type) put(t, click(1.4), 0.10, -0.1);
for (const t of T.sfx.tick) put(t, click(1.8), 0.13, 0.1);
// ending: a warm bell chord
for (const [i, m] of [72, 76, 79].entries()) put(T.sfx.end + i * 0.05, bell(m, 2.6), 0.13, (i - 1) * 0.3);

// ---- feedback delay (cheap room), master, fade -----------------------------------------------
const dl = Math.floor(beat * 0.75 * SR);
const fbL = new Float32Array(N), fbR = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const wl = i >= dl ? fbR[i - dl] : 0, wr = i >= dl ? fbL[i - dl] : 0;
  fbL[i] = L[i] + wl * 0.32; fbR[i] = R[i] + wr * 0.32;
}
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = clamp01(t / 0.6) * clamp01((DUR - t) / 1.3);
  L[i] = (L[i] * 0.8 + fbL[i] * 0.35) * fade; R[i] = (R[i] * 0.8 + fbR[i] * 0.35) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.85 / peak;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(Math.tanh(L[i] * norm * 1.1) * 32000), i * 4);
  pcm.writeInt16LE(Math.round(Math.tanh(R[i] * norm * 1.1) * 32000), i * 4 + 2);
}
const wav = Buffer.alloc(44 + pcm.length);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
mkdirSync(dirname(OUT), { recursive: true });
const tmp = resolve(tmpdir(), `showsteps-track-${process.pid}.wav`);
writeFileSync(tmp, wav);
const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", tmp, "-c:a", "libmp3lame", "-b:a", "256k", OUT], { stdio: "inherit" });
rmSync(tmp, { force: true });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${OUT} (${DUR}s, ${BPM} bpm, peak ${peak.toFixed(2)})`);
