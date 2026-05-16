/**
 * Inference pipeline using essentia.js (mel preprocessing) + onnxruntime-node (ONNX).
 * Audio decode: ffmpeg → raw PCM float32 mono 16kHz
 * Mel spectrogram: essentia.js MelBands — same preprocessing as infer.ts
 * Inference: onnxruntime-node native bindings (CPU, thread-safe — no mutex needed)
 *
 * macOS setup: after first `deno run -A elite.ts` (which downloads npm deps), clear quarantine:
 *   find node_modules/.deno/onnxruntime-node* -name "*.dylib" -o -name "*.node" | xargs xattr -d com.apple.quarantine 2>/dev/null
 */
import * as ort from 'onnxruntime-node'
import * as esLib from 'essentia.js'

// ---------------------------------------------------------------------------
// Essentia singleton
// ---------------------------------------------------------------------------
async function createEssentia(): Promise<typeof esLib.Essentia.prototype> {
	const wasm = typeof esLib.EssentiaWASM === 'function' ? await (esLib.EssentiaWASM as () => Promise<unknown>)() : esLib.EssentiaWASM
	return new esLib.Essentia(wasm)
}

const essentiaReady: Promise<typeof esLib.Essentia.prototype> = createEssentia()

// ---------------------------------------------------------------------------
// Constants matching TensorflowPredictEffnetDiscogs preprocessing
// ---------------------------------------------------------------------------
const SR = 16000
const FRAME_SIZE = 512
const HOP_SIZE = 256
const N_MELS = 96
const PATCH_SIZE = 128
const N_FFT = FRAME_SIZE / 2 + 1 // 257
const EMB_SIZE = 1280

// ---------------------------------------------------------------------------
// Mel spectrogram via essentia.js
// ---------------------------------------------------------------------------
function computeMelPatches(pcm: Float32Array, essentia: typeof esLib.Essentia.prototype): Float32Array | null {
	const frames = essentia.FrameGenerator(pcm, FRAME_SIZE, HOP_SIZE)
	const numFrames: number = frames.size()

	if (numFrames < PATCH_SIZE) {
		frames.delete()
		return null
	}

	const melFrames: Float32Array[] = []

	for (let i = 0; i < numFrames; i++) {
		const frame = frames.get(i)
		const win = essentia.Windowing(frame, /* normalized= */ false, FRAME_SIZE, 'hann')
		frame.delete()
		const spec = essentia.Spectrum(win.frame, FRAME_SIZE)
		const melRes = essentia.MelBands(
			spec.spectrum,
			/* highFrequencyBound= */ 8000,
			/* inputSize= */ N_FFT,
			/* log= */ false,
			/* lowFrequencyBound= */ 0,
			/* normalize= */ 'unit_tri',
			/* numberBands= */ N_MELS,
			/* sampleRate= */ SR,
			/* type= */ 'power',
			/* warpingFormula= */ 'slaneyMel',
			/* weighting= */ 'linear',
		)

		const raw = essentia.vectorToArray(melRes.bands) as Float32Array
		const logMel = Float32Array.from(raw, (v) => Math.log10(v * 10000 + 1))
		melFrames.push(logMel)

		win.frame.delete()
		spec.spectrum.delete()
		melRes.bands.delete()
	}
	frames.delete()

	const numPatches = Math.floor(numFrames / PATCH_SIZE)
	const out = new Float32Array(numPatches * PATCH_SIZE * N_MELS)
	for (let p = 0; p < numPatches; p++) {
		for (let f = 0; f < PATCH_SIZE; f++) {
			out.set(melFrames[p * PATCH_SIZE + f], (p * PATCH_SIZE + f) * N_MELS)
		}
	}
	return out // [numPatches, 128, 96] flat
}

// ---------------------------------------------------------------------------
// Audio decode via ffmpeg → Float32 PCM mono 16kHz
// ---------------------------------------------------------------------------
async function getDurationSeconds(filePath: string): Promise<number> {
	const { code, stdout } = await new Deno.Command('ffprobe', {
		args: ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
		stdout: 'piped',
		stderr: 'null',
	}).output()
	if (code !== 0) return 0
	return parseFloat(new TextDecoder().decode(stdout).trim()) || 0
}

async function decodeAudio(filePath: string, maxSeconds?: number, fromStart = false): Promise<Float32Array> {
	const args: string[] = []
	if (maxSeconds !== undefined) {
		if (fromStart) {
			args.push('-t', String(maxSeconds))
		} else {
			const totalDuration = await getDurationSeconds(filePath)
			if (totalDuration > maxSeconds) {
				const offset = (totalDuration - maxSeconds) / 2
				args.push('-ss', String(offset), '-t', String(maxSeconds))
			}
		}
	}
	args.push('-i', filePath, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-loglevel', 'quiet', '-')

	const { code, stdout, stderr } = await new Deno.Command('ffmpeg', {
		args,
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	if (code !== 0) {
		throw new Error(`ffmpeg failed (exit ${code}): ${new TextDecoder().decode(stderr).slice(0, 300)}`)
	}
	return new Float32Array(stdout.buffer)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface ModelSessions {
	backbone: ort.InferenceSession
	moodtheme: ort.InferenceSession
	genre: ort.InferenceSession
	top50tags: ort.InferenceSession
}

export async function loadModels(paths: {
	backbone: string
	moodtheme: string
	genre: string
	top50tags: string
}): Promise<ModelSessions> {
	const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['cpu'] }
	const [backbone, moodtheme, genre, top50tags] = await Promise.all([
		ort.InferenceSession.create(paths.backbone, opts),
		ort.InferenceSession.create(paths.moodtheme, opts),
		ort.InferenceSession.create(paths.genre, opts),
		ort.InferenceSession.create(paths.top50tags, opts),
	])
	return { backbone, moodtheme, genre, top50tags }
}

const BACKBONE_BATCH = 32

// Native ORT sessions are thread-safe — no mutex needed across concurrent workers.
export async function inferFile(
	filePath: string,
	sessions: ModelSessions,
	maxSeconds?: number,
): Promise<{ moodtheme: number[]; genre: number[]; top50tags: number[] }> {
	const essentia = await essentiaReady

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const pcm = await decodeAudio(filePath, maxSeconds, attempt > 0)
			const patches = computeMelPatches(pcm, essentia)
			if (!patches) throw new Error('audio too short')

			const numPatches = patches.length / (PATCH_SIZE * N_MELS)
			const bbInputName = sessions.backbone.inputNames[0]

			const moodAcc = new Float64Array(56)
			const genreAcc = new Float64Array(87)
			const tagsAcc = new Float64Array(50)

			for (let start = 0; start < numPatches; start += BACKBONE_BATCH) {
				const end = Math.min(start + BACKBONE_BATCH, numPatches)
				const batchSize = end - start
				const batchData = patches.slice(start * PATCH_SIZE * N_MELS, end * PATCH_SIZE * N_MELS)

				const bbInput = new ort.Tensor('float32', batchData, [batchSize, PATCH_SIZE, N_MELS])
				const bbOut = await sessions.backbone.run({ [bbInputName]: bbInput })
				const embeds = Float32Array.from(bbOut['embeddings'].data as Float32Array)
				bbInput.dispose()
				for (const t of Object.values(bbOut)) (t as ort.Tensor).dispose()

				for (let p = 0; p < batchSize; p++) {
					const emb = embeds.slice(p * EMB_SIZE, (p + 1) * EMB_SIZE)
					const embTensor = new ort.Tensor('float32', emb, [1, EMB_SIZE])

					const [moodOut, genreOut, tagsOut] = await Promise.all([
						sessions.moodtheme.run({ [sessions.moodtheme.inputNames[0]]: embTensor }),
						sessions.genre.run({ [sessions.genre.inputNames[0]]: embTensor }),
						sessions.top50tags.run({ [sessions.top50tags.inputNames[0]]: embTensor }),
					])
					embTensor.dispose()

					const moodTensor = moodOut[sessions.moodtheme.outputNames[0]]
					const genreTensor = genreOut[sessions.genre.outputNames[0]]
					const tagsTensor = tagsOut[sessions.top50tags.outputNames[0]]
					const md = moodTensor.data as Float32Array
					const gd = genreTensor.data as Float32Array
					const td = tagsTensor.data as Float32Array
					for (let i = 0; i < md.length; i++) moodAcc[i] += md[i]
					for (let i = 0; i < gd.length; i++) genreAcc[i] += gd[i]
					for (let i = 0; i < td.length; i++) tagsAcc[i] += td[i]
					moodTensor.dispose()
					genreTensor.dispose()
					tagsTensor.dispose()
				}
			}

			return {
				moodtheme: Array.from(moodAcc, (v) => v / numPatches),
				genre: Array.from(genreAcc, (v) => v / numPatches),
				top50tags: Array.from(tagsAcc, (v) => v / numPatches),
			}
		} catch (err) {
			if (attempt === 0 && !(err instanceof Error)) continue
			if (err instanceof Error) throw err
			throw new Error(String(err))
		}
	}
	throw new Error('inference failed after retry')
}
