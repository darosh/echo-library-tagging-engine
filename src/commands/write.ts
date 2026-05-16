import { join } from '@std/path'
import { Database } from '@db/sqlite'
import { getPendingForWrite, lookupSimplified, setWriteDone, setWriteError } from '../utils/db.ts'
import { ensureSimplify, SimplifyOption } from '../utils/simplify.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function write(opts: {
	db: Database
	root: string
	format: string
	dryRun: boolean
	concurrency: number
	ignore: string[]
	simplify: SimplifyOption
	simplifyReset: boolean
	maxMoods: number
}): Promise<void> {
	const { db, root, format, dryRun, concurrency, ignore, simplify, simplifyReset, maxMoods } = opts

	printHeader(`Writing Genre tags (format: "${format}")`)

	if (simplify !== false) ensureSimplify(db, simplify, ignore, simplifyReset, maxMoods)

	const pending = getPendingForWrite(db, ignore)
	if (pending.length === 0) {
		printInfo('No files pending write — run analyze first or all already written')
		return
	}

	printInfo(`${pending.length} files to tag`)

	if (dryRun) {
		for (const f of pending.slice(0, 20)) {
			const simplified = simplify !== false ? lookupSimplified(db, f.mood ?? '', f.tag ?? '') : ''
			const tag = applyFormat(format, f.mood ?? '', f.genre_2 ?? f.genre_1 ?? '', simplified)
			printInfo(`[dry-run] ${f.path}\n           Genre → "${tag}"`)
		}
		if (pending.length > 20) printInfo(`[dry-run] … and ${pending.length - 20} more`)
		return
	}

	const progress = new Progress(pending.length, 'Writing tags')
	let errors = 0

	for (let i = 0; i < pending.length; i += concurrency) {
		const batch = pending.slice(i, i + concurrency)
		await Promise.all(batch.map(async (file) => {
			const simplified = simplify !== false ? lookupSimplified(db, file.mood ?? '', file.tag ?? '') : ''
			const tag = applyFormat(format, file.mood ?? '', file.genre_2 ?? file.genre_1 ?? '', simplified)
			try {
				await writeTag(join(root, file.path), tag)
				setWriteDone(db, file.id)
			} catch (err) {
				setWriteError(db, file.id)
				errors++
				printError(file.path, err instanceof Error ? err.message : String(err))
			}
			progress.increment(file.path.split('/').pop() ?? '')
		}))
	}

	printSuccess(`Tagged ${pending.length - errors} files (${errors} errors)`)
}

function applyFormat(format: string, mood: string, original: string, simplified: string): string {
	return format
		.replace(/%mood%/g, mood)
		.replace(/%original%/g, original)
		.replace(/%simplified%/g, simplified)
}

export async function writeTag(filePath: string, genre: string): Promise<void> {
	// kid3-cli silently skips saves when given NFD paths (macOS exiftool stores NFD); normalize to NFC
	const nfcPath = filePath.normalize('NFC')
	// Remove ID3v1 tag entirely — it can't store custom genre strings and players may prefer it over ID3v2
	const removeResult = await new Deno.Command('kid3-cli', {
		args: ['-c', 'remove 1', '-c', 'save', nfcPath],
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	const removeStdout = new TextDecoder().decode(removeResult.stdout).trim()
	if (removeResult.code !== 0 || removeStdout) {
		throw new Error(`kid3-cli failed: ${removeStdout || new TextDecoder().decode(removeResult.stderr).trim()}`)
	}

	const result = await new Deno.Command('kid3-cli', {
		args: ['-c', `set genre "${genre}" 2`, '-c', 'save', nfcPath],
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	const stdoutText = new TextDecoder().decode(result.stdout).trim()
	const stderrText = new TextDecoder().decode(result.stderr).trim()
	if (result.code !== 0 || stdoutText) {
		throw new Error(`kid3-cli failed: ${stdoutText || stderrText}`)
	}
}
