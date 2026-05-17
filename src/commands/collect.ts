import { dirname, relative } from '@std/path'
import { walk } from '@std/fs'
import { Database } from '@db/sqlite'
import { upsertFile } from '../utils/db.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'
import type { ErrorMsg, ResultMsg } from '../workers/collect-worker.ts'

export const DEFAULT_FILTER = '**/*.{mp3,flac,dsf}'
const SUPPORTED_EXTS = new Set(['.mp3', '.flac', '.dsf'])

export async function collect(opts: {
	db: Database
	root: string
	filter: string
	dryRun: boolean
	concurrency: number
}): Promise<void> {
	const { db, root, filter, dryRun } = opts
	const concurrency = Math.max(1, Math.floor(opts.concurrency))

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
	let nextFolder = 0
	let albumErrors = 0
	let failedFiles = 0
	const workerUrl = import.meta.resolve('../workers/collect-worker.ts')

	async function runWorker() {
		const worker = new Worker(workerUrl, { type: 'module' })

		await new Promise<void>((resolve, reject) => {
			worker.onerror = (e) => reject(new Error(e.message))

			function next() {
				const folderEntry = folders[nextFolder++]
				if (!folderEntry) {
					worker.terminate()
					resolve()
					return
				}
				const [_folder, folderFiles] = folderEntry
				worker.postMessage({ type: 'process', root, folder: _folder, files: folderFiles })
			}

			worker.onmessage = (e: MessageEvent<ResultMsg | ErrorMsg>) => {
				const msg = e.data
				if (msg.type === 'result') {
					writeAlbumRows(db, msg.rows)
					for (const row of msg.rows) progress.increment(row.relPath)
				}
				if (msg.type === 'error') {
					albumErrors++
					failedFiles += msg.fileCount
					printError(msg.folder, msg.message)
					for (let i = 0; i < msg.fileCount; i++) progress.increment(msg.folder)
				}
				next()
			}

			next()
		})
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, folders.length) }, runWorker))

	printSuccess(`Collected ${files.length - failedFiles} files into database (${albumErrors} album errors)`)
}

function writeAlbumRows(db: Database, rows: ResultMsg['rows']): void {
	db.exec('BEGIN')
	try {
		for (const row of rows) {
			upsertFile(
				db,
				row.relPath,
				row.mtime,
				row.genre1,
				row.genre2,
				row.title2,
				row.trackNumber2,
				row.artist2,
				row.albumArtist2,
				row.date2,
				row.discNumber2,
				row.parsed,
			)
		}
		db.exec('COMMIT')
	} catch (err) {
		db.exec('ROLLBACK')
		throw err
	}
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
