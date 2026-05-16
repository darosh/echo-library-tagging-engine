/**
 * Inference pipeline using essentia.js (mel preprocessing) + onnxruntime-web (ONNX).
 * Audio decode: ffmpeg → raw PCM float32 mono 16kHz
 * Mel spectrogram: essentia.js MelBands(normalize='unit_tri', type='power', warpingFormula='slaneyMel', weighting='linear', log=false) + log10(x*10000+1)
 * Inference: onnxruntime-web (pure WASM, no native addons)
 */
import * as ort from 'onnxruntime-web'
import * as esLib from 'essentia.js'

// Point ORT's WASM loader at the dist/ directory in Deno's npm cache.
// import.meta.resolve gives us the entry file (dist/ort.node.min.mjs);
// "./" keeps us in that same dist/ folder rather than going to the package root.
{
	const distDir = new URL('./', import.meta.resolve('onnxruntime-web')).href
	ort.env.wasm.wasmPaths = distDir
	ort.env.wasm.numThreads = 1
}

// ---------------------------------------------------------------------------
// Essentia singleton — EssentiaWASM may be a module or async factory
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
			/* log= */ false, // no internal log; we apply the shift+log10 below
			/* lowFrequencyBound= */ 0,
			/* normalize= */ 'unit_tri',
			/* numberBands= */ N_MELS,
			/* sampleRate= */ SR,
			/* type= */ 'power',
			/* warpingFormula= */ 'slaneyMel', // matches TensorflowInputMusiCNN (used by TensorflowPredictEffnetDiscogs)
			/* weighting= */ 'linear',
		)

		// TensorflowInputMusiCNN post-processing: shift(scale=10000, shift=1) then log10
		// i.e. log10(band * 10000 + 1)
		const raw = essentia.vectorToArray(melRes.bands) as Float32Array
		const logMel = Float32Array.from(raw, (v) => Math.log10(v * 10000 + 1))
		melFrames.push(logMel)

		// free WASM heap allocations
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
// When maxSeconds is provided, seeks to the central slice before decoding
// to avoid reading large files in full (important for DSF/FLAC).
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

// Serializes all ORT run() calls — WASM linear memory is shared across sessions
// in the same process, so concurrent inference corrupts internal state.
export class OrtMutex {
	private tail = Promise.resolve()
	run<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.tail.then(fn)
		this.tail = next.then(() => {}, () => {})
		return next
	}
}

export async function loadModels(paths: {
	backbone: string
	moodtheme: string
	genre: string
	top50tags: string
}): Promise<ModelSessions> {
	const [backbone, moodtheme, genre, top50tags] = await Promise.all([
		ort.InferenceSession.create(paths.backbone),
		ort.InferenceSession.create(paths.moodtheme),
		ort.InferenceSession.create(paths.genre),
		ort.InferenceSession.create(paths.top50tags),
	])
	return { backbone, moodtheme, genre, top50tags }
}

const BACKBONE_BATCH = 32 // avoid oversized WASM tensors for long tracks

export async function inferFile(
	filePath: string,
	sessions: ModelSessions,
	maxSeconds?: number,
	mutex?: OrtMutex,
): Promise<{ moodtheme: number[]; genre: number[]; top50tags: number[] }> {
	const essentia = await essentiaReady

	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const pcm = await decodeAudio(filePath, maxSeconds, attempt > 0)
			const patches = computeMelPatches(pcm, essentia)
			if (!patches) throw new Error('audio too short')

			// Wrap the entire inference block in the mutex so no two files run ORT
			// concurrently — ORT WASM shares linear memory across sessions and
			// corrupts internal state under concurrent use.
			const infer = async () => {
				const numPatches = patches.length / (PATCH_SIZE * N_MELS)
				const bbInputName = sessions.backbone.inputNames[0]

				// Accumulate per-patch predictions (averaging predictions ≈ what
				// TensorflowPredictEffnetDiscogs does internally, and is more correct
				// than averaging embeddings before classification).
				const moodAcc = new Float64Array(56)
				const genreAcc = new Float64Array(87)
				const tagsAcc = new Float64Array(50)

				// Process backbone in batches to cap WASM heap usage
				for (let start = 0; start < numPatches; start += BACKBONE_BATCH) {
					const end = Math.min(start + BACKBONE_BATCH, numPatches)
					const batchSize = end - start
					const batchData = patches.slice(start * PATCH_SIZE * N_MELS, end * PATCH_SIZE * N_MELS)

					const bbInput = new ort.Tensor('float32', batchData, [batchSize, PATCH_SIZE, N_MELS])
					const bbOut = await sessions.backbone.run({ [bbInputName]: bbInput }, { embeddings: null })
					// Copy out of WASM-backed memory before disposing the tensor
					const embeds = Float32Array.from(bbOut['embeddings'].data as Float32Array)
					bbInput.dispose()
					bbOut['embeddings'].dispose()

					// Run each patch embedding through all three heads and accumulate
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
			} // end infer

			return await (mutex ? mutex.run(infer) : infer())
		} catch (err) {
			// numeric WASM crash (essentia or ORT) — likely silent center slice; retry from start
			const isWasmCrash = !isNaN(Number(String(err))) && String(err).trim() !== ''
			if (attempt === 0 && isWasmCrash) continue
			if (err instanceof Error) throw err
			throw new Error(String(err))
		}
	} // end attempt loop
	throw new Error('inference failed after retry')
}
