import { Database } from '@db/sqlite'
import { ensureDirSync } from '@std/fs'
import { extname, join, relative } from '@std/path'
import { getFilesWithMood } from '../utils/db.ts'
import { matchGlob } from './collect.ts'
import { MOOD_SIMILARITY } from '../utils/mood-similarity.ts'

const TRACK_PREFIX = /^(?:\d{1,3}-\d{1,3}|\d{1,3})(?:\s*-\s*|\.\s+|\s+)/

function stripTrackFilename(filename: string): string {
	const ext = extname(filename)
	const stem = filename.slice(0, -ext.length || undefined)
	return (stem.replace(TRACK_PREFIX, '') || stem) + ext
}

function toAsciiSegment(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function transformPath(relPath: string, stripTrack: boolean, ascii: boolean): string {
	if (!stripTrack && !ascii) return relPath
	const segments = relPath.split('/')
	return segments.map((seg, i) => {
		const isFile = i === segments.length - 1
		let s = seg
		if (isFile && stripTrack) s = stripTrackFilename(s)
		if (ascii) s = toAsciiSegment(s)
		return s
	}).join('/')
}

function moodCoords(mood: string): [number, number] {
	return MOOD_SIMILARITY[mood.toLowerCase()] ?? [0, 0]
}

function dist(a: [number, number], b: [number, number]): number {
	return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
}

function collapseMoods(counts: { mood: string; count: number }[], maxMoods: number): Map<string, string> {
	if (counts.length === 0) return new Map()

	const groups = new Map<string, string>(counts.map((m) => [m.mood, m.mood]))

	const canonical = (mood: string): string => {
		let c = groups.get(mood) ?? mood
		while (groups.get(c) !== c) c = groups.get(c)!
		return c
	}

	const distinctCanonicals = (): Set<string> => new Set(counts.map((m) => canonical(m.mood)))

	while (distinctCanonicals().size > maxMoods) {
		const arr = Array.from(distinctCanonicals())

		const canonicalCount = new Map<string, number>()
		for (const c of arr) canonicalCount.set(c, 0)
		for (const { mood, count } of counts) {
			const c = canonical(mood)
			canonicalCount.set(c, (canonicalCount.get(c) ?? 0) + count)
		}

		let mergeFrom = arr[0]
		for (const c of arr) {
			if ((canonicalCount.get(c) ?? 0) < (canonicalCount.get(mergeFrom) ?? 0)) mergeFrom = c
		}

		let mergeTo = ''
		let minD = Infinity
		for (const c of arr) {
			if (c === mergeFrom) continue
			const d = dist(moodCoords(mergeFrom), moodCoords(c))
			if (d < minD) {
				minD = d
				mergeTo = c
			}
		}

		groups.set(mergeFrom, mergeTo)
	}

	const result = new Map<string, string>()
	for (const { mood } of counts) {
		const c = canonical(mood)
		if (c !== mood) result.set(mood, c)
	}
	return result
}

export async function moodPlaylists(opts: {
	db: Database
	input: string
	output: string
	filter: string
	max?: number
	stripTrack: boolean
	ascii: boolean
}): Promise<void> {
	const { db, input, output, filter, max, stripTrack, ascii } = opts

	const files = getFilesWithMood(db).filter((f) => matchGlob(f.path, filter))

	if (files.length === 0) {
		console.log('No analyzed files found in input directory.')
		return
	}

	const countMap = new Map<string, number>()
	for (const f of files) {
		countMap.set(f.mood, (countMap.get(f.mood) ?? 0) + 1)
	}
	const counts = Array.from(countMap, ([mood, count]) => ({ mood, count }))

	let collapseMap = new Map<string, string>()
	if (max !== undefined && max < counts.length) {
		collapseMap = collapseMoods(counts, max)
	}

	const resolve = (mood: string): string => collapseMap.get(mood) ?? mood

	const groups = new Map<string, typeof files>()
	for (const f of files) {
		const mood = resolve(f.mood)
		if (!groups.has(mood)) groups.set(mood, [])
		groups.get(mood)!.push(f)
	}

	ensureDirSync(output)

	for (const [mood, group] of groups) {
		const ext = ascii ? '.m3u' : '.m3u8'
		const filename = mood.toLowerCase().replace(/\s+/g, '_') + ext
		const outPath = `${output}/${filename}`
		const lines: string[] = ['#EXTM3U']
		for (const f of group) {
			const rel = transformPath(relative(output, join(input, f.path)), stripTrack, ascii)
			const displayName = stripTrack && ascii
				? (f.strip_ascii_name ?? f.file_name)
				: stripTrack
				? (f.strip_name ?? f.file_name)
				: ascii
				? (f.ascii_name ?? f.file_name)
				: null
			if (displayName) lines.push(`#EXTINF:-1,${displayName}`)
			lines.push(rel)
		}
		await Deno.writeTextFile(outPath, lines.join('\n') + '\n')
	}

	const rows = Array.from(groups.entries())
		.map(([mood, group]) => ({ mood, count: group.length }))
		.sort((a, b) => b.count - a.count)
	const moodCol = Math.max(...rows.map((r) => r.mood.length), 'mood'.length)
	const countCol = Math.max(...rows.map((r) => String(r.count).length), 'tracks'.length)
	console.log(`${'mood'.padEnd(moodCol)}  ${'tracks'.padStart(countCol)}`)
	console.log(`${'-'.repeat(moodCol)}  ${'-'.repeat(countCol)}`)
	for (const { mood, count } of rows) {
		console.log(`${mood.padEnd(moodCol)}  ${String(count).padStart(countCol)}`)
	}
	console.log(`\nWrote ${groups.size} playlists to ${output}`)
}
