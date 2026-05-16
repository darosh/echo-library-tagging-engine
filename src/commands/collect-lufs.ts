import { join } from '@std/path'
import { Database } from '@db/sqlite'
import { getFilesForLufs, saveAlbumLufs } from '../utils/db.ts'
import { printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'
import { DEFAULT_FILTER, matchGlob } from './collect.ts'

export async function collectLufs(opts: {
	db: Database
	root: string
	filter: string
	concurrency: number
	dryRun: boolean
}): Promise<void> {
	const { db, root, filter, concurrency, dryRun } = opts

	printHeader(`Collecting album LUFS via rsgain (filter: ${filter})`)

	const allFiles = getFilesForLufs(db)
	const files = filter === DEFAULT_FILTER ? allFiles : allFiles.filter(({ path }) => matchGlob(path, filter))

	if (files.length === 0) {
		printInfo('No MP3 files pending LUFS collection — already done or run collect-db first')
		return
	}

	// Group by parent directory (album)
	const byDir = new Map<string, string[]>()
	for (const { path: relPath } of files) {
		const absPath = join(root, relPath)
		const dir = absPath.slice(0, absPath.lastIndexOf('/'))
		const group = byDir.get(dir) ?? []
		group.push(absPath)
		byDir.set(dir, group)
	}

	const albums = [...byDir.entries()]
	printInfo(`Found ${files.length} files across ${albums.length} album directories`)

	if (dryRun) {
		for (const [dir, paths] of albums.slice(0, 10)) {
			printInfo(`[dry-run] Would scan ${paths.length} files in ${dir}`)
		}
		if (albums.length > 10) printInfo(`[dry-run] … and ${albums.length - 10} more albums`)
		return
	}

	const progress = new Progress(albums.length, 'LUFS scan')

	for (let i = 0; i < albums.length; i += concurrency) {
		const batch = albums.slice(i, i + concurrency)
		await Promise.all(batch.map(async ([_dir, absPaths]) => {
			const result = await scanAlbum(absPaths)
			if (result) {
				for (const absPath of absPaths) {
					const relPath = absPath.slice(root.length).replace(/^\//, '')
					saveAlbumLufs(db, relPath, result.lufs, result.peak, result.gain)
				}
			}
			progress.increment(_dir)
		}))
	}

	printSuccess(`Collected album LUFS for ${files.length} files`)
}

interface AlbumLufs {
	lufs: number
	peak: number
	gain: number
}

async function scanAlbum(absPaths: string[]): Promise<AlbumLufs | null> {
	const { code, stdout } = await new Deno.Command('rsgain', {
		args: ['custom', '-a', ...absPaths],
		stdout: 'piped',
		stderr: 'null',
	}).output()
	if (code !== 0) return null
	return parseAlbumSection(new TextDecoder().decode(stdout))
}

function parseAlbumSection(output: string): AlbumLufs | null {
	// Find the "Album:" section and extract Loudness, Peak, Gain
	const albumIdx = output.indexOf('\nAlbum:')
	if (albumIdx === -1) return null
	const section = output.slice(albumIdx)

	const lufs = parseValue(section, /Loudness:\s*([-\d.]+)\s*LUFS/)
	const peak = parseValue(section, /Peak:\s*([\d.]+)/)
	const gain = parseValue(section, /Gain:\s*([-\d.]+)\s*dB/)

	if (lufs === null || peak === null || gain === null) return null
	return { lufs, peak, gain }
}

function parseValue(text: string, re: RegExp): number | null {
	const m = text.match(re)
	if (!m) return null
	const val = parseFloat(m[1])
	return isNaN(val) ? null : val
}
