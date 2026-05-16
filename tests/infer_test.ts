import { assertEquals, assertExists, assert } from "@std/assert";
import { join } from "@std/path";
import { tempPath, makeSineFlac, makeSineMp3, makeSineDsf } from "./helpers.ts";

const MODELS_DIR = join(new URL("../models/", import.meta.url).pathname.replace(/%20/g, " "), "");

const SR = 16000;
const FRAME_SIZE = 512;
const HOP_SIZE = 256;
const N_MELS = 96;
const PATCH_SIZE = 128;
const N_FFT = FRAME_SIZE / 2 + 1;

// Shared sine fixtures generated once for the module
const MP3_FIXTURE = await (async () => { const p = await tempPath(".mp3"); await makeSineMp3(p, 5); return p; })();
const FLAC_FIXTURE = await (async () => { const p = await tempPath(".flac"); await makeSineFlac(p, 5); return p; })();
const DSF_FIXTURE = await (async () => {
  const p = await tempPath(".dsf");
  try { await makeSineDsf(p, 3); } catch { return null; }
  return p;
})();

// ---------------------------------------------------------------------------
// Step 1: ffmpeg decode
// ---------------------------------------------------------------------------
Deno.test("decodeAudio: ffmpeg produces float32 PCM (MP3)", async () => {
  const { code, stdout, stderr } = await new Deno.Command("ffmpeg", {
    args: ["-i", MP3_FIXTURE, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-loglevel", "quiet", "-"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(code, 0, `ffmpeg failed: ${new TextDecoder().decode(stderr)}`);
  const pcm = new Float32Array(stdout.buffer);
  assert(pcm.length > SR, `Expected >${SR} samples, got ${pcm.length}`);
  console.log(`  ✓ decoded ${pcm.length} samples (${(pcm.length / SR).toFixed(1)}s)`);
});

Deno.test("decodeAudio: ffmpeg decodes FLAC", async () => {
  const { code, stdout, stderr } = await new Deno.Command("ffmpeg", {
    args: ["-i", FLAC_FIXTURE, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-loglevel", "quiet", "-t", "5", "-"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(code, 0, `ffmpeg failed: ${new TextDecoder().decode(stderr)}`);
  const pcm = new Float32Array(stdout.buffer);
  assert(pcm.length > SR, `Expected >${SR} samples, got ${pcm.length}`);
  console.log(`  ✓ FLAC decoded ${pcm.length} samples (${(pcm.length / SR).toFixed(1)}s)`);
});

Deno.test("decodeAudio: ffmpeg decodes DSF", async () => {
  if (!DSF_FIXTURE) {
    console.log("  ⚠ DSF generation not supported by this ffmpeg build, skipping");
    return;
  }
  const { code, stdout, stderr } = await new Deno.Command("ffmpeg", {
    args: ["-i", DSF_FIXTURE, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-loglevel", "quiet", "-t", "5", "-"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(code, 0, `ffmpeg failed: ${new TextDecoder().decode(stderr)}`);
  const pcm = new Float32Array(stdout.buffer);
  assert(pcm.length > SR, `Expected >${SR} samples, got ${pcm.length}`);
  console.log(`  ✓ DSF decoded ${pcm.length} samples (${(pcm.length / SR).toFixed(1)}s)`);
});

// ---------------------------------------------------------------------------
// Step 2: essentia.js mel spectrogram
// ---------------------------------------------------------------------------
async function initEssentia() {
  const wasm = typeof esLib.EssentiaWASM === "function"
    ? await (esLib.EssentiaWASM as () => Promise<unknown>)()
    : esLib.EssentiaWASM;
  return new esLib.Essentia(wasm);
}
import * as esLib from "essentia.js";

Deno.test("essentia.js: initialises correctly", async () => {
  const essentia = await initEssentia();
  assertExists(essentia.FrameGenerator);
  assertExists(essentia.MelBands);
  console.log(`  ✓ essentia.js ${essentia.version}`);
});

Deno.test("computeMelPatches: correct shape and non-zero values", async () => {
  const essentia = await initEssentia();
  const { stdout } = await new Deno.Command("ffmpeg", {
    args: ["-i", MP3_FIXTURE, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-loglevel", "quiet", "-"],
    stdout: "piped", stderr: "null",
  }).output();
  const pcm = new Float32Array(stdout.buffer);

  const frames = essentia.FrameGenerator(pcm, FRAME_SIZE, HOP_SIZE);
  const numFrames = frames.size();
  assert(numFrames > PATCH_SIZE, `only ${numFrames} frames`);

  const frame = frames.get(0);
  const win = essentia.Windowing(frame, false, FRAME_SIZE, "hann");
  const spec = essentia.Spectrum(win.frame, FRAME_SIZE);
  const melRes = essentia.MelBands(spec.spectrum, 8000, N_FFT, false, 0, "unit_tri", N_MELS, SR, "power");
  const bands = essentia.vectorToArray(melRes.bands) as Float32Array;

  assertEquals(bands.length, N_MELS);
  assert(bands.some(v => v > 0), "all mel bands zero");
  const sample = Array.from(bands.slice(0, 5)).map(v => v.toExponential(2)).join(", ");
  console.log(`  ✓ ${numFrames} frames, mel[0:5]: [${sample}]`);

  win.frame.delete(); spec.spectrum.delete(); melRes.bands.delete(); frames.delete();
});

// ---------------------------------------------------------------------------
// Step 3: onnxruntime
// ---------------------------------------------------------------------------
import * as ort from "onnxruntime-web";

Deno.test("onnxruntime: Tensor creation", () => {
  const data = new Float32Array([1, 2, 3, 4]);
  const t = new ort.Tensor("float32", data, [1, 4]);
  assertEquals(Array.from(t.dims), [1, 4]);
  console.log(`  ✓ Tensor ok`);
});

Deno.test({ name: "onnxruntime-web: load backbone model", sanitizeResources: false }, async () => {
  const path = join(MODELS_DIR, "discogs-effnet-bsdynamic-1.onnx");
  const session = await ort.InferenceSession.create(path);
  console.log(`  ✓ backbone loaded`);
  assertExists(session.inputNames[0]);
  assertExists(session.outputNames[0]);
});

// ---------------------------------------------------------------------------
// Step 4: end-to-end inference
// ---------------------------------------------------------------------------
Deno.test({ name: "inferFile: full pipeline on sine MP3", sanitizeResources: false }, async () => {
  const { inferFile, loadModels } = await import("../src/infer.ts");

  const sessions = await loadModels({
    backbone: join(MODELS_DIR, "discogs-effnet-bsdynamic-1.onnx"),
    moodtheme: join(MODELS_DIR, "mtg_jamendo_moodtheme-discogs-effnet-1.onnx"),
    genre: join(MODELS_DIR, "mtg_jamendo_genre-discogs-effnet-1.onnx"),
    top50tags: join(MODELS_DIR, "mtg_jamendo_top50tags-discogs-effnet-1.onnx"),
  });

  const result = await inferFile(MP3_FIXTURE, sessions);
  assertEquals(result.moodtheme.length, 56, `moodtheme length: ${result.moodtheme.length}`);
  assertEquals(result.top50tags.length, 50, `top50tags length: ${result.top50tags.length}`);
  console.log(`  ✓ moodtheme[${result.moodtheme.length}], top50tags[${result.top50tags.length}]`);
});

Deno.test({ name: "inferFile: full pipeline on sine FLAC (maxSeconds=5)", sanitizeResources: false }, async () => {
  const { inferFile, loadModels } = await import("../src/infer.ts");

  const sessions = await loadModels({
    backbone: join(MODELS_DIR, "discogs-effnet-bsdynamic-1.onnx"),
    moodtheme: join(MODELS_DIR, "mtg_jamendo_moodtheme-discogs-effnet-1.onnx"),
    top50tags: join(MODELS_DIR, "mtg_jamendo_top50tags-discogs-effnet-1.onnx"),
    genre: join(MODELS_DIR, "mtg_jamendo_genre-discogs-effnet-1.onnx"),
  });

  const result = await inferFile(FLAC_FIXTURE, sessions, 5);
  assertEquals(result.moodtheme.length, 56);
  assertEquals(result.top50tags.length, 50);
  console.log(`  ✓ FLAC inference ok`);
});
