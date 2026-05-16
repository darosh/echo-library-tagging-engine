import { dirname, extname, join, relative } from '@std/path'
import { ensureDir, walk } from '@std/fs'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'
import { matchGlob } from './collect.ts'

const MAC_ARTIFACT_NAMES = new Set([
	'.DS_Store',
	'.Spotlight-V100',
	'.fseventsd',
	'.Trashes',
	'.TemporaryItems',
	'.DocumentRevisions-V100',
	'.VolumeIcon.icns',
	'desktop.ini',
	'Thumbs.db',
])

function isMacArtifact(name: string): boolean {
	return name.startsWith('._') || MAC_ARTIFACT_NAMES.has(name)
}

// Matches: "01 - TITLE", "1-01 - TITLE", "01 TITLE", "1-01 TITLE", "01. TITLE", "1-01. TITLE"
const TRACK_PREFIX = /^(?:\d{1,3}-\d{1,3}|\d{1,3})(?:\s*-\s*|\.\s+|\s+)/

function stripTrack(filename: string): string {
	const ext = extname(filename)
	const stem = filename.slice(0, -ext.length || undefined)
	const stripped = stem.replace(TRACK_PREFIX, '')
	return (stripped || stem) + ext
}

function toAsciiFilename(filename: string): string {
	const ext = extname(filename)
	const stem = filename.slice(0, -ext.length || undefined)
	const ascii = stem.normalize('NFD').replace(/[̀-ͯ]/g, '')
	return ascii + ext
}

function uniqueName(dir: string, name: string, used: Map<string, Set<string>>): string {
	const set = used.get(dir) ?? new Set<string>()
	used.set(dir, set)
	if (!set.has(name)) {
		set.add(name)
		return name
	}
	const ext = extname(name)
	const stem = name.slice(0, -ext.length || undefined)
	let i = 1
	while (true) {
		const candidate = `${stem} (${i})${ext}`
		if (!set.has(candidate)) {
			set.add(candidate)
			return candidate
		}
		i++
	}
}

export interface CopyOptions {
	root: string
	filter: string
	dest: string
	dryRun: boolean
	overwrite: boolean
	stripTrack?: boolean
	ascii?: boolean
}

export async function copy(opts: CopyOptions): Promise<void> {
	const { root, filter, dest, dryRun, overwrite } = opts

	printHeader(`Copying from ${root} to ${dest} (filter: ${filter})`)

	const files: { absPath: string; relPath: string }[] = []

	for await (const entry of walk(root, { includeDirs: false })) {
		if (isMacArtifact(entry.name)) continue
		const relPath = relative(root, entry.path)
		if (!matchGlob(relPath, filter)) continue
		files.push({ absPath: entry.path, relPath })
	}

	files.sort((a, b) => a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0)

	if (dryRun) {
		const dryUsed = new Map<string, Set<string>>()
		const preview = files.slice(0, 20)
		for (const { relPath } of preview) {
			const segments = relPath.split('/')
			const last = segments.length - 1
			let filename = segments[last]
			if (opts.stripTrack) filename = stripTrack(filename)
			if (opts.ascii) filename = toAsciiFilename(filename)
			const dirSegments = segments.slice(0, last).map((seg) => opts.ascii ? toAsciiFilename(seg) : seg)
			const dir = dirSegments.join('/')
			filename = uniqueName(dir, filename, dryUsed)
			const destRelPath = join(dir, filename)
			const arrow = destRelPath !== relPath ? ` → ${destRelPath}` : ''
			printInfo(`[dry-run] Would copy: ${relPath}${arrow}`)
		}
		if (files.length > 20) {
			printInfo(`[dry-run] ... and ${files.length - 20} more`)
		}
		printSuccess(`[dry-run] Would copy ${files.length} files to ${dest}`)
		return
	}

	const progress = new Progress(files.length)
	let errors = 0
	let skipped = 0
	const usedNames = new Map<string, Set<string>>()

	for (const { absPath, relPath } of files) {
		const segments = relPath.split('/')
		const last = segments.length - 1
		let filename = segments[last]
		if (opts.stripTrack) filename = stripTrack(filename)
		if (opts.ascii) filename = toAsciiFilename(filename)
		const dirSegments = segments.slice(0, last).map((seg) => opts.ascii ? toAsciiFilename(seg) : seg)
		const dir = dirSegments.join('/')
		filename = uniqueName(dir, filename, usedNames)
		const destPath = join(dest, dir, filename)
		try {
			await ensureDir(dirname(destPath))
			if (!overwrite) {
				try {
					await Deno.stat(destPath)
					skipped++
					progress.increment(relPath.split('/').pop() ?? relPath)
					continue
				} catch {
					// file doesn't exist, proceed with copy
				}
			}
			const data = await Deno.readFile(absPath)
			await Deno.writeFile(destPath, data)
		} catch (err) {
			printError(relPath, err instanceof Error ? err.message : String(err))
			errors++
		}
		progress.increment(relPath.split('/').pop() ?? relPath)
	}

	const copied = files.length - errors - skipped
	const parts = [`Copied ${copied} files to ${dest}`]
	if (skipped > 0) parts.push(`${skipped} skipped (already exist)`)
	if (errors > 0) parts.push(`${errors} errors`)
	printSuccess(parts.join(', '))
}
