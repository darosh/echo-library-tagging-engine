import { extname, relative } from '@std/path'
import { parsePath } from '../utils/paths.ts'

const KID3_FIELDS = [
	'genre 2',
	'title 2',
	'tracknumber 2',
	'artist 2',
	'albumartist 2',
	'date 2',
	'discnumber 2',
	// Keep ID3v1 genre last: when absent, kid3-cli emits no output line for it.
	'genre 1',
]

interface ProcessMsg {
	type: 'process'
	root: string
	folder: string
	files: string[]
}

export interface CollectRow {
	relPath: string
	mtime: number | null
	genre1: string | null
	genre2: string | null
	title2: string | null
	trackNumber2: string | null
	artist2: string | null
	albumArtist2: string | null
	date2: string | null
	discNumber2: string | null
	parsed: ReturnType<typeof parsePath>
}

export interface ResultMsg {
	type: 'result'
	folder: string
	rows: CollectRow[]
}

export interface ErrorMsg {
	type: 'error'
	folder: string
	fileCount: number
	message: string
}

// deno-lint-ignore no-explicit-any
const ctx = self as any

ctx.onmessage = async (event: MessageEvent<ProcessMsg>) => {
	const msg = event.data

	try {
		const parsedByPath = new Map<string, ReturnType<typeof parsePath>>()
		const used = new Map<string, number>()

		for (const filePath of msg.files) {
			const relPath = relative(msg.root, filePath)
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

			parsedByPath.set(filePath, parsed)
		}

		const rows = await Promise.all(msg.files.map(async (filePath) => {
			const nfcPath = filePath.normalize('NFC')
			const [fields, stat] = await Promise.all([
				readKid3Fields(nfcPath, KID3_FIELDS),
				Deno.stat(filePath).catch(() => null),
			])
			const relPath = relative(msg.root, filePath)
			const [genre2, title2, trackNumber2, artist2, albumArtist2, date2, discNumber2, genre1] = fields
			return {
				relPath,
				mtime: stat?.mtime?.getTime() ?? null,
				genre1,
				genre2,
				title2,
				trackNumber2,
				artist2,
				albumArtist2,
				date2,
				discNumber2,
				parsed: parsedByPath.get(filePath)!,
			}
		}))

		ctx.postMessage({ type: 'result', folder: msg.folder, rows } satisfies ResultMsg)
	} catch (err) {
		ctx.postMessage(
			{
				type: 'error',
				folder: msg.folder,
				fileCount: msg.files.length,
				message: err instanceof Error ? err.message : String(err),
			} satisfies ErrorMsg,
		)
	}
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
