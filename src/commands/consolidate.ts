import { join } from '@std/path'
import { Database } from '@db/sqlite'
import { getCollectedGenreByGenreStats, getFilesForConsolidate } from '../utils/db.ts'
import { consolidateGenre } from '../utils/genres.ts'
import { computeGenreCollapse } from '../utils/genre-similarity.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function consolidate(opts: {
	db: Database
	root: string
	topGenres: number
	ignore: string[]
	ignoreOldGenres: string[]
	concurrency: number
	dryRun: boolean
}): Promise<void> {
	const { db, root, topGenres, ignore, ignoreOldGenres, concurrency, dryRun } = opts
	const ignoreOldGenresSet = new Set(ignoreOldGenres.map((g) => g.toLowerCase()))

	printHeader(`Consolidating genres (top ${topGenres})`)

	// Build genre collapse map from same data source as stats
	const originalByGenreRows = getCollectedGenreByGenreStats(db, ignore)
	const consolidatedMap = new Map<string, number>()
	for (const r of originalByGenreRows) {
		const g = consolidateGenre(r.original_genre, r.genre, ignoreOldGenresSet)
		consolidatedMap.set(g, (consolidatedMap.get(g) ?? 0) + r.count)
	}
	const consolidatedRows = [...consolidatedMap.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count)

	const collapseMap = computeGenreCollapse(consolidatedRows, topGenres)

	const files = getFilesForConsolidate(db, ignore)
	if (files.length === 0) {
		printInfo('No files to consolidate — run analyze first')
		return
	}

	printInfo(`${files.length} files to tag`)

	if (dryRun) {
		for (const f of files.slice(0, 20)) {
			const consolidated = consolidateGenre(f.original_genre, f.genre, ignoreOldGenresSet)
			const genre = collapseMap.get(consolidated) ?? consolidated
			printInfo(`[dry-run] ${f.path}\n           Genre → "${genre}"`)
		}
		if (files.length > 20) printInfo(`[dry-run] … and ${files.length - 20} more`)
		return
	}

	const progress = new Progress(files.length, 'Writing tags')
	let errors = 0

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency)
		await Promise.all(batch.map(async (file) => {
			const consolidated = consolidateGenre(file.original_genre, file.genre, ignoreOldGenresSet)
			const genre = collapseMap.get(consolidated) ?? consolidated
			try {
				await writeConsolidatedTag(join(root, file.path), genre)
			} catch (err) {
				errors++
				printError(file.path, err instanceof Error ? err.message : String(err))
			}
			progress.increment(file.path.split('/').pop() ?? '')
		}))
	}

	printSuccess(`Tagged ${files.length - errors} files (${errors} errors)`)
}

export async function writeConsolidatedTag(filePath: string, genre: string): Promise<void> {
	// kid3-cli silently skips saves when given NFD paths (macOS exiftool stores NFD); normalize to NFC
	const result = await new Deno.Command('kid3-cli', {
		args: ['-c', `set genre "${genre}" 2`, '-c', 'copy 2', '-c', 'paste 1', '-c', 'save', filePath.normalize('NFC')],
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	const stdoutText = new TextDecoder().decode(result.stdout).trim()
	const stderrText = new TextDecoder().decode(result.stderr).trim()
	// kid3-cli exits 0 even for missing/unreadable files, reporting errors on stdout
	if (result.code !== 0 || stdoutText) {
		throw new Error(`kid3-cli failed: ${stdoutText || stderrText}`)
	}
}
