import { join } from '@std/path'
import { Database } from '@db/sqlite'
import { getPendingForAnalysis, saveAnalysis, setAnalyzeError } from '../utils/db.ts'
import { ensureModels } from '../utils/models-loader.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'
import type { ErrorMsg, ReadyMsg, ResultMsg } from '../workers/infer-native-worker.ts'

export async function analyzeNative(opts: {
	db: Database
	root: string
	modelsDir: string
	concurrency: number
	dryRun: boolean
	maxSeconds?: number
	ignore: string[]
}): Promise<void> {
	const { db, root, modelsDir, concurrency, dryRun, maxSeconds, ignore } = opts

	printHeader('Analyzing with MTG-Jamendo models (discogs-effnet backbone, native ORT)')
	printHeader(`Using ${concurrency} workers`)
	const pending = getPendingForAnalysis(db, ignore)
	if (pending.length === 0) {
		printInfo('No files pending analysis — run collect first or all already done')
		return
	}

	printInfo(`${pending.length} files to analyze`)

	if (dryRun) {
		for (const f of pending.slice(0, 10)) printInfo(`[dry-run] Would analyze: ${f.path}`)
		if (pending.length > 10) printInfo(`[dry-run] … and ${pending.length - 10} more`)
		return
	}

	const modelPaths = await ensureModels(modelsDir)
	const moodLabels = modelPaths.classes.moodtheme
	const genreLabels = modelPaths.classes.genre
	const tagLabels = modelPaths.classes.top50tags

	const progress = new Progress(pending.length, 'Analyzing')
	let errors = 0

	const workerUrl = import.meta.resolve('../workers/infer-native-worker.ts')
	const queue = [...pending]

	async function runWorker() {
		const worker = new Worker(workerUrl, { type: 'module' })

		// Wait for worker to finish loading models
		await new Promise<void>((resolve, reject) => {
			worker.onmessage = (e: MessageEvent<ReadyMsg>) => {
				if (e.data.type === 'ready') resolve()
			}
			worker.onerror = (e) => reject(new Error(e.message))
			worker.postMessage({ type: 'init', modelPaths, maxSeconds })
		})

		// Process files sequentially until queue is empty; each worker owns one file at a time
		await new Promise<void>((resolve) => {
			let currentFile: { id: number; path: string } | null = null

			function next() {
				if (queue.length === 0) {
					worker.terminate()
					resolve()
					return
				}
				currentFile = queue.shift()!
				worker.postMessage({ type: 'process', id: currentFile.id, filePath: join(root, currentFile.path) })
			}

			worker.onmessage = (e: MessageEvent<ResultMsg | ErrorMsg>) => {
				const msg = e.data
				if (msg.type === 'result') {
					const topMood = moodLabels[msg.moodtheme.reduce((b, v, i) => v > msg.moodtheme[b] ? i : b, 0)]
					const topGenre = genreLabels[msg.genre.reduce((b, v, i) => v > msg.genre[b] ? i : b, 0)]
					const topTag = tagLabels[msg.top50tags.reduce((b, v, i) => v > msg.top50tags[b] ? i : b, 0)]
					saveAnalysis(db, msg.id, topMood, topGenre, topTag)
				} else {
					if (msg.message === 'audio too short') {
						saveAnalysis(db, msg.id, 'unknown', 'unknown', 'unknown')
					} else {
						setAnalyzeError(db, msg.id)
						errors++
						printError(currentFile?.path ?? String(msg.id), msg.message)
					}
				}
				progress.increment(currentFile?.path.split('/').pop() ?? '')
				next()
			}

			next()
		})
	}

	await Promise.all(Array.from({ length: concurrency }, runWorker))

	printSuccess(`Analyzed ${pending.length - errors} files (${errors} errors)`)
}
