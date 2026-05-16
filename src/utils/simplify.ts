import { Database } from '@db/sqlite'
import { clearSimplify, getMoodStats, getMoodTagStats, getSimplifyRows, setMoodCollapseMap, setSimplifyRows } from './db.ts'
import { MOOD_COORDS } from './mood.ts'

export type SimplifyOption = number | 'auto' | false

export function parseSimplify(value: string): SimplifyOption {
	if (value === 'false') return false
	if (value === 'auto') return 'auto'
	const n = parseInt(value, 10)
	if (!isNaN(n) && n > 0) return n
	return 'auto'
}

function moodCoords(mood: string): [number, number] {
	return MOOD_COORDS[mood.toLowerCase()] ?? [0, 0]
}

function dist(a: [number, number], b: [number, number]): number {
	return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
}

function detectAutoCutoff(rows: { mood: string; tag: string; count: number }[]): number {
	// Scan from the tail (lowest counts) upward. When two consecutive step-ups
	// both exceed 1.33x we've found the boundary between the "important head"
	// and the "long tail". Return the index of the first tail entry (i.e. keep
	// everything before it).
	for (let i = rows.length - 1; i >= 2; i--) {
		const r1 = rows[i - 1].count / rows[i].count
		const r2 = rows[i - 2].count / rows[i - 1].count
		if (r1 > 1.33 && r2 > 1.33) return i
	}
	return rows.length
}

export function computeMoodCollapse(
	allMoodCounts: { mood: string; count: number }[],
	_namedMoods: Set<string>,
	maxMoods: number,
): Map<string, string> {
	if (allMoodCounts.length === 0) return new Map()

	// Each mood starts as its own group; groups maps mood → canonical representative
	const groups = new Map<string, string>(allMoodCounts.map((m) => [m.mood, m.mood]))

	// Resolve the current canonical for a mood (following chain)
	const canonical = (mood: string): string => {
		let c = groups.get(mood) ?? mood
		while (groups.get(c) !== c) c = groups.get(c)!
		return c
	}

	const distinctCanonicals = (): Set<string> => new Set(allMoodCounts.map((m) => canonical(m.mood)))

	// Iteratively eliminate the smallest-count canonical by merging it into its nearest neighbor
	while (distinctCanonicals().size > maxMoods) {
		const arr = Array.from(distinctCanonicals())

		// Accumulate total count per canonical (sum of all moods that resolve to it)
		const canonicalCount = new Map<string, number>()
		for (const c of arr) canonicalCount.set(c, 0)
		for (const { mood, count } of allMoodCounts) {
			const c = canonical(mood)
			canonicalCount.set(c, (canonicalCount.get(c) ?? 0) + count)
		}

		// Pick the canonical with the smallest total count
		let mergeFrom = arr[0]
		for (const c of arr) {
			if ((canonicalCount.get(c) ?? 0) < (canonicalCount.get(mergeFrom) ?? 0)) mergeFrom = c
		}

		// Merge it into its nearest neighbor
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

	// Build result: only include moods that actually got remapped
	const result = new Map<string, string>()
	for (const mood of allMoodCounts.map((m) => m.mood)) {
		const c = canonical(mood)
		if (c !== mood) result.set(mood, c)
	}
	return result
}

export function ensureSimplify(
	db: Database,
	simplify: SimplifyOption,
	ignore: string[] = [],
	reset = false,
	maxMoods = 10,
): void {
	if (simplify === false) return

	if (reset) clearSimplify(db)

	const existing = getSimplifyRows(db)
	if (existing.length > 0) return // reuse stored table

	const rows = getMoodTagStats(db, ignore)
	if (rows.length === 0) return

	let cutoff: number
	if (typeof simplify === 'number') {
		cutoff = Math.min(simplify, rows.length)
	} else {
		cutoff = detectAutoCutoff(rows)
	}

	const kept = rows.slice(0, cutoff)
	setSimplifyRows(db, kept.map((r) => ({ mood: r.mood, tag: r.tag })))

	// Second pass: collapse tail moods into nearest canonical mood
	const namedMoods = new Set(kept.map((r) => r.mood))
	const allMoodCounts = getMoodStats(db, ignore)
	const collapseMap = computeMoodCollapse(allMoodCounts, namedMoods, maxMoods)
	if (collapseMap.size > 0) setMoodCollapseMap(db, collapseMap)
}
