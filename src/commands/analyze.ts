import { join } from '@std/path'
import { Database } from '@db/sqlite'
import { getPendingForAnalysis, saveAnalysis } from '../utils/db.ts'
import { ensureModels } from '../utils/models-loader.ts'
import { inferFile, loadModels, OrtMutex } from '../utils/infer.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function analyze(opts: {
	db: Database
	root: string
	modelsDir: string
	concurrency: number
	dryRun: boolean
	maxSeconds?: number
	ignore: string[]
	models: string[]
}): Promise<void> {
	const { db, root, modelsDir, concurrency, dryRun, maxSeconds, ignore, models } = opts

	printHeader('Analyzing with MTG-Jamendo models (discogs-effnet backbone)')
	printHeader(`Using ${concurrency} workers, models: ${models.join(', ')}`)
	const pending = getPendingForAnalysis(db, models, ignore)
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

	const sessions = await loadModels(modelPaths)
	const mutex = new OrtMutex()
	const queue = [...pending]
	async function worker() {
		while (queue.length > 0) {
			const file = queue.shift()!
			const absPath = join(root, file.path)
			try {
				const { moodtheme, genre, top50tags } = await inferFile(absPath, sessions, maxSeconds, mutex)

				const topMood = moodLabels[moodtheme.reduce((b, v, i) => v > moodtheme[b] ? i : b, 0)]
				const topGenre = genreLabels[genre.reduce((b, v, i) => v > genre[b] ? i : b, 0)]
				const topTag = tagLabels[top50tags.reduce((b, v, i) => v > top50tags[b] ? i : b, 0)]

				saveAnalysis(db, file.id, models, topMood, topGenre, topTag)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				if (msg === 'audio too short') {
					saveAnalysis(db, file.id, models, 'unknown', 'unknown', 'unknown')
				} else {
					errors++
					printError(file.path, msg)
				}
			}
			progress.increment(file.path.split('/').pop() ?? '')
		}
	}

	await Promise.all(Array.from({ length: concurrency }, worker))

	printSuccess(`Analyzed ${pending.length - errors} files (${errors} errors)`)
}
