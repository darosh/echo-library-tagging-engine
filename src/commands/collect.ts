import { dirname, relative } from '@std/path'
import { walk } from '@std/fs'
import { extname } from '@std/path'
import { Database } from '@db/sqlite'
import { parsePath, upsertFile } from '../utils/db.ts'
import { printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export const DEFAULT_FILTER = '**/*.{mp3,flac,dsf}'
const SUPPORTED_EXTS = new Set(['.mp3', '.flac', '.dsf'])

// 'genre 1' (ID3v1) is queried separately because it emits no output line when
// the ID3v1 tag is absent, which would shift all subsequent index-based field mappings.
const KID3_FIELDS_GENRE1 = ['genre 1']
const KID3_FIELDS = [
	'genre 2',
	'title 2',
	'tracknumber 2',
	'artist 2',
	'albumartist 2',
	'date 2',
	'discnumber 2',
]

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

	// Group files by folder for folder-level strip_ascii_name deduplication
	const byFolder = new Map<string, string[]>()
	for (const filePath of files) {
		const relPath = relative(root, filePath)
		const folder = dirname(relPath)
		const group = byFolder.get(folder) ?? []
		group.push(filePath)
		byFolder.set(folder, group)
	}
	const folders = [...byFolder.entries()]

	const progress = new Progress(files.length, 'Collecting')

	for (let i = 0; i < folders.length; i += concurrency) {
		const batch = folders.slice(i, i + concurrency)
		await Promise.all(batch.map(async ([_folder, folderFiles]) => {
			// Collect kid3 + stat for all files in folder in parallel
			const results = await Promise.all(folderFiles.map(async (filePath) => {
				const nfcPath = filePath.normalize('NFC')
				const [genre1Fields, fields, stat] = await Promise.all([
					readKid3Fields(nfcPath, KID3_FIELDS_GENRE1),
					readKid3Fields(nfcPath, KID3_FIELDS),
					Deno.stat(filePath).catch(() => null),
				])
				return { filePath, genre1Fields, fields, stat }
			}))

			// Build parsed paths and deduplicate strip_ascii_name within folder
			const used = new Map<string, number>()
			for (const { filePath, genre1Fields, fields, stat } of results) {
				const relPath = relative(root, filePath)
				const parsed = parsePath(relPath)

				const base = parsed.strip_ascii_name
				if (!used.has(base)) {
					used.set(base, 1)
				} else {
					const n = used.get(base)!
					used.set(base, n + 1)
					const ext = extname(base)
					const stem = base.slice(0, -ext.length || undefined)
					parsed.strip_ascii_name = `${stem} (${n})${ext}`
				}

				const mtime = stat?.mtime?.getTime() ?? null
				const [genre1] = genre1Fields
				const [genre2, title2, trackNumber2, artist2, albumArtist2, date2, discNumber2] = fields
				upsertFile(db, relPath, mtime, genre1, genre2, title2, trackNumber2, artist2, albumArtist2, date2, discNumber2, parsed)
				progress.increment(relPath)
			}
		}))
	}

	printSuccess(`Collected ${files.length} files into database`)
}

async function readKid3Fields(nfcPath: string, fields: string[]): Promise<(string | null)[]> {
	const args: string[] = []
	for (const field of fields) {
		args.push('-c', `get ${field}`)
	}
	args.push(nfcPath)
	const { code, stdout } = await new Deno.Command('kid3-cli', {
		args,
		stdout: 'piped',
		stderr: 'null',
	}).output()
	if (code !== 0) return fields.map(() => null)
	const lines = new TextDecoder().decode(stdout).split('\n')
	return fields.map((_, i) => {
		const val = (lines[i] ?? '').trim()
		return val || null
	})
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
