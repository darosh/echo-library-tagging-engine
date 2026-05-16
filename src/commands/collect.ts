import { relative } from '@std/path'
import { walk } from '@std/fs'
import { Database } from '@db/sqlite'
import { upsertFile } from '../utils/db.ts'
import { printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export const DEFAULT_FILTER = '**/*.{mp3,flac,dsf}'
const SUPPORTED_EXTS = new Set(['.mp3', '.flac', '.dsf'])

export async function collect(opts: {
	db: Database
	root: string
	filter: string
	dryRun: boolean
	concurrency: number
}): Promise<void> {
	const { db, root, filter, dryRun, concurrency } = opts

	printHeader(`Collecting metadata from ${root} (filter: ${filter})`)

	const files: string[] = []
	for await (const entry of walk(root, { includeDirs: false, followSymlinks: false })) {
		const ext = entry.path.slice(entry.path.lastIndexOf('.')).toLowerCase()
		if (!SUPPORTED_EXTS.has(ext)) continue
		const rel = relative(root, entry.path)
		if (filter !== DEFAULT_FILTER && !matchGlob(rel, filter)) continue
		files.push(entry.path)
	}

	printInfo(`Found ${files.length} files`)

	if (dryRun) {
		for (const f of files.slice(0, 20)) {
			printInfo(`[dry-run] Would collect: ${relative(root, f)}`)
		}
		if (files.length > 20) printInfo(`[dry-run] … and ${files.length - 20} more`)
		return
	}

	const progress = new Progress(files.length, 'Collecting')

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency)
		await Promise.all(batch.map(async (filePath) => {
			const relPath = relative(root, filePath)
			const nfcPath = filePath.normalize('NFC')
			const [genre1, genre2, title2, trackNumber2, artist2, albumArtist2, date2, discNumber2, stat] = await Promise.all([
				readKid3Field(nfcPath, 'genre 1'),
				readKid3Field(nfcPath, 'genre 2'),
				readKid3Field(nfcPath, 'title 2'),
				readKid3Field(nfcPath, 'tracknumber 2'),
				readKid3Field(nfcPath, 'artist 2'),
				readKid3Field(nfcPath, 'albumartist 2'),
				readKid3Field(nfcPath, 'date 2'),
				readKid3Field(nfcPath, 'discnumber 2'),
				Deno.stat(filePath).catch(() => null),
			])
			const mtime = stat?.mtime?.getTime() ?? null
			upsertFile(db, relPath, mtime, genre1, genre2, title2, trackNumber2, artist2, albumArtist2, date2, discNumber2)
			progress.increment(relPath)
		}))
	}

	printSuccess(`Collected ${files.length} files into database`)
}

async function readKid3Field(nfcPath: string, field: string): Promise<string | null> {
	const { code, stdout } = await new Deno.Command('kid3-cli', {
		args: ['-c', `get ${field}`, nfcPath],
		stdout: 'piped',
		stderr: 'null',
	}).output()
	if (code !== 0) return null
	const val = new TextDecoder().decode(stdout).trim()
	return val || null
}

// Minimal glob matching for **/*.ext, subdirectory patterns, and {a,b,c} brace expansion
export function matchGlob(path: string, pattern: string): boolean {
	const regexStr = pattern
		.replace(/[.+^$[\]\\]/g, '\\$&') // escape regex specials (not {}()|*)
		.replace(/\{([^}]+)\}/g, (_, inner) => `(${inner.split(',').join('|')})`) // {a,b} → (a|b)
		.replace(/\*\*/g, '__GLOBSTAR__')
		.replace(/\*/g, '[^/]*')
		.replace(/__GLOBSTAR__/g, '.*')
	return new RegExp(`^${regexStr}$`).test(path)
}
