import { Database } from '@db/sqlite'
import {
	getCollectedGenreByGenreStats,
	getCollectedGenreStats,
	getGenreStats,
	getGenreTagStats,
	getMoodGenreStats,
	getMoodStats,
	getMoodTagStats,
	getSimplifiedGenreTagStats,
	getSimplifiedGenreTagStatsAlphabetical,
	getSimplifiedGenreTagStatsSorted,
	getTagStats,
	getTotalFiles,
} from '../utils/db.ts'
import { ensureSimplify, SimplifyOption } from '../utils/simplify.ts'
import { bold, cyan, gray, green, magenta, printHeader, yellow } from '../utils/progress.ts'
import { consolidateGenre, GENRES } from '../utils/genres.ts'
import { computeGenreCollapse } from '../utils/genre-similarity.ts'

const KNOWN_GENRES = new Set(GENRES.map((g) => g.toLowerCase()))

const GROUP_COLORS = [
	green,
	cyan,
	yellow,
	magenta,
	(s: string) => `\x1b[38;5;208m${s}\x1b[0m`, // orange
	(s: string) => `\x1b[38;5;99m${s}\x1b[0m`, // purple
	(s: string) => `\x1b[38;5;45m${s}\x1b[0m`, // sky
	(s: string) => `\x1b[38;5;196m${s}\x1b[0m`, // red
	(s: string) => `\x1b[38;5;220m${s}\x1b[0m`, // gold
	(s: string) => `\x1b[38;5;118m${s}\x1b[0m`, // lime
	(s: string) => `\x1b[38;5;213m${s}\x1b[0m`, // pink
	(s: string) => `\x1b[38;5;159m${s}\x1b[0m`, // ice
]

function colorForLabel(label: string): (s: string) => string {
	const key = label.split(' / ')[0].trim()
	let hash = 0
	for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
	return GROUP_COLORS[hash % GROUP_COLORS.length]
}

function printDistribution(
	title: string,
	rows: { label: string; count: number }[],
	labelWidth: number,
): void {
	const total = rows.reduce((s, r) => s + r.count, 0)
	printHeader(`${title} (${rows.length} groups)`)

	if (rows.length === 0) {
		console.log(gray('  No data yet.'))
		console.log()
		return
	}

	const maxCount = Math.max(...rows.map((r) => r.count))
	const barWidth = 40

	console.log()
	rows.forEach((row) => {
		const color = colorForLabel(row.label)
		const pct = (row.count / total) * 100
		const filled = Math.round((row.count / maxCount) * barWidth)
		const bar = color('█'.repeat(filled)) + gray('░'.repeat(barWidth - filled))
		const label = bold(row.label.padEnd(labelWidth))
		const countStr = cyan(String(row.count).padStart(5))
		const pctStr = gray(`${pct.toFixed(1)}%`.padStart(7))
		console.log(`  ${label}  [${bar}]  ${countStr} ${pctStr}`)
	})
	console.log()
}

export function stats(
	opts: { db: Database; ignore: string[]; ignoreOldGenres: string[]; simplify: SimplifyOption; simplifyReset: boolean; maxMoods: number; topGenres: number },
): void {
	const { db, ignore, ignoreOldGenres, simplify, simplifyReset, maxMoods, topGenres } = opts
	const ignoreOldGenresSet = new Set(ignoreOldGenres.map((g) => g.toLowerCase()))

	const total = getTotalFiles(db)
	const moodRows = getMoodStats(db, ignore)
	const analyzed = moodRows.reduce((s, r) => s + r.count, 0)

	if (moodRows.length === 0) {
		printHeader('Stats')
		console.log(gray('  No analysis data yet. Run the analyze command first.'))
		return
	}

	const originalGenreRows = getCollectedGenreStats(db, ignore)
	const originalGenreByGenreRows = getCollectedGenreByGenreStats(db, ignore)
	const genreRows = getGenreStats(db, ignore)
	const tagRows = getTagStats(db, ignore)
	const moodGenreRows = getMoodGenreStats(db, ignore)
	const moodTagRows = getMoodTagStats(db, ignore)
	const genreTagRows = getGenreTagStats(db, ignore)

	const longestSingle = Math.max(
		...moodRows.map((r) => r.mood.length),
		...genreRows.map((r) => r.genre.length),
		...tagRows.map((r) => r.tag.length),
	)
	const labelWidth = longestSingle * 2 + ' / '.length

	printDistribution(
		'Collected Genres (* = not in ID3v1 standard)',
		originalGenreRows.map((r) => ({
			label: KNOWN_GENRES.has(r.genre.toLowerCase()) ? r.genre : `*${r.genre}`,
			count: r.count,
		})),
		labelWidth,
	)

	printDistribution(
		'Original Genre × Detected Genre',
		originalGenreByGenreRows.map((r) => ({
			label: `${KNOWN_GENRES.has(r.original_genre.toLowerCase()) ? r.original_genre : `*${r.original_genre}`} / ${r.genre}`,
			count: r.count,
		})),
		labelWidth,
	)

	const consolidatedMap = new Map<string, number>()
	for (const r of originalGenreByGenreRows) {
		const g = consolidateGenre(r.original_genre, r.genre, ignoreOldGenresSet)
		consolidatedMap.set(g, (consolidatedMap.get(g) ?? 0) + r.count)
	}
	const consolidatedRows = [...consolidatedMap.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count)
	printDistribution('Consolidated Genres', consolidatedRows, labelWidth)

	const genreCollapseMap = computeGenreCollapse(consolidatedRows, topGenres)
	const topGenreMap = new Map<string, number>()
	for (const { label, count } of consolidatedRows) {
		const key = genreCollapseMap.get(label) ?? label
		topGenreMap.set(key, (topGenreMap.get(key) ?? 0) + count)
	}
	const topGenreRows = [...topGenreMap.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count)
	printDistribution(`Top Genres (top ${topGenres})`, topGenreRows, labelWidth)

	printDistribution(
		'Mood Distribution',
		moodRows.map((r) => ({ label: r.mood, count: r.count })),
		labelWidth,
	)

	printDistribution(
		'Genre Distribution',
		genreRows.map((r) => ({ label: r.genre, count: r.count })),
		labelWidth,
	)

	printDistribution(
		'Tag Distribution',
		tagRows.map((r) => ({ label: r.tag, count: r.count })),
		labelWidth,
	)

	printDistribution(
		'Mood × Genre',
		moodGenreRows.map((r) => ({ label: `${r.mood} / ${r.genre}`, count: r.count })),
		labelWidth,
	)

	printDistribution(
		'Genre × Tag',
		genreTagRows.map((r) => ({ label: `${r.genre} / ${r.tag}`, count: r.count })),
		labelWidth,
	)

	printDistribution(
		'Mood × Tag',
		moodTagRows.map((r) => ({ label: `${r.mood} / ${r.tag}`, count: r.count })),
		labelWidth,
	)

	if (simplify !== false) {
		ensureSimplify(db, simplify, ignore, simplifyReset, maxMoods)
		const simplifiedRows = getSimplifiedGenreTagStats(db, ignore)
		printDistribution('Simplified Mood × Tag', simplifiedRows, labelWidth)
		const sortedRows = getSimplifiedGenreTagStatsSorted(db, ignore)
		printDistribution('Sorted Simplified Mood × Tag', sortedRows, labelWidth)
		const alphabeticalRows = getSimplifiedGenreTagStatsAlphabetical(db, ignore)
		printDistribution('Alphabetical Simplified Mood × Tag', alphabeticalRows, labelWidth)
	}

	console.log(`  ${gray('Total files:')} ${cyan(String(total))}   ${gray('Analyzed:')} ${cyan(String(analyzed))}`)
	if (analyzed < total) {
		console.log(gray(`  ${total - analyzed} files not yet analyzed`))
	}
	console.log()
}
