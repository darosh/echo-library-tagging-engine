import { walk } from '@std/fs'
import { relative } from '@std/path'
import { matchGlob } from './collect.ts'

type AudioKind = 'mp3' | 'flac' | 'dsf' | 'wav' | 'ape' | 'ogg' | 'm4a' | 'wma'
const KINDS: AudioKind[] = ['mp3', 'flac', 'dsf', 'wav', 'ape', 'ogg', 'm4a', 'wma']

const extMap: Record<string, AudioKind> = {
	'.mp3': 'mp3',
	'.flac': 'flac',
	'.dsf': 'dsf',
	'.wav': 'wav',
	'.ape': 'ape',
	'.ogg': 'ogg',
	'.m4a': 'm4a',
	'.wma': 'wma',
}

function empty(): Record<AudioKind, number> {
	return { mp3: 0, flac: 0, dsf: 0, wav: 0, ape: 0, ogg: 0, m4a: 0, wma: 0 }
}

export async function sdCount(opts: { target: string; filter?: string }): Promise<void> {
	const { target, filter } = opts

	const allCounts = new Map<string, Record<AudioKind, number>>()
	const filteredCounts = new Map<string, Record<AudioKind, number>>()
	const otherExts = new Set<string>()

	for await (const entry of walk(target, { includeDirs: false, maxDepth: 10 })) {
		const ext = entry.path.slice(entry.path.lastIndexOf('.')).toLowerCase()
		const kind = extMap[ext]

		if (!kind) {
			if (ext && ext !== '.') otherExts.add(ext.slice(1))
			continue
		}

		const rel = relative(target, entry.path)
		const topLevel = rel.split('/')[0]

		if (!allCounts.has(topLevel)) allCounts.set(topLevel, empty())
		allCounts.get(topLevel)![kind]++

		if (!filter || matchGlob(rel, filter)) {
			if (!filteredCounts.has(topLevel)) filteredCounts.set(topLevel, empty())
			filteredCounts.get(topLevel)![kind]++
		}
	}

	const folders = [...allCounts.keys()].sort((a, b) => a.localeCompare(b))

	const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

	const colW = 6
	const folderW = 50
	const cols = KINDS.map((k) => k.toUpperCase().padStart(colW)).join(' ')
	const lineW = folderW + 2 + KINDS.length * (colW + 1)

	console.log(bold(`${'Folder'.padEnd(folderW)}  ${cols}`))
	console.log('─'.repeat(lineW))

	const totals = empty()
	const allTotals = empty()

	for (const folder of folders) {
		const all = allCounts.get(folder)!
		for (const k of KINDS) allTotals[k] += all[k]

		const c = filteredCounts.get(folder)
		if (!c) continue

		for (const k of KINDS) totals[k] += c[k]
		const row = KINDS.map((k) => String(c[k]).padStart(colW)).join(' ')
		console.log(`${folder.padEnd(folderW)}  ${row}`)
	}

	const selected = KINDS.reduce((s, k) => s + totals[k], 0)
	console.log('─'.repeat(lineW))
	const totalRow = KINDS.map((k) => String(totals[k]).padStart(colW)).join(' ')
	console.log(bold(`${'TOTAL'.padEnd(folderW)}  ${totalRow}  (${selected} selected)`))
	if (filter) {
		const allRow = KINDS.map((k) => String(allTotals[k]).padStart(colW)).join(' ')
		console.log(dim(`${'ALL'.padEnd(folderW)}  ${allRow}`))
	}

	if (otherExts.size > 0) {
		console.log(`\nOther file types: ${[...otherExts].sort().join(', ')}`)
	}
}
