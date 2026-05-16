import { relative } from '@std/path'
import { GENRES } from '../utils/genres.ts'
import { DEFAULT_FILTER, matchGlob } from './collect.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

const VALID_TAGS = new Set(['title', 'artist', 'album', 'track', 'genre', 'art'])
const ART_MAX = 500
const VALID_GENRES = new Set(GENRES.filter(Boolean).map((g) => g.toLowerCase()))

interface ExiftoolEntry {
	SourceFile: string
	Title?: string
	Artist?: string
	Album?: string
	TrackNumber?: string | number
	Track?: string | number
	Genre?: string
	PictureWidth?: number
	PictureHeight?: number
	Picture?: string
	PictureMIMEType?: string
	[key: string]: unknown
}

function isJpegMime(mime: string): boolean {
	const m = mime.toLowerCase()
	return m === 'image/jpeg' || m === 'image/jpg' || m === 'jpg' || m === 'jpeg'
}

const PROGRESSIVE_SOF_MARKERS = new Set([0xC2, 0xC6, 0xCA, 0xCE])
const ALL_SOF_MARKERS = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF])

function isProgressiveJpeg(bytes: Uint8Array): boolean {
	if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return false
	let i = 2
	while (i < bytes.length - 1) {
		if (bytes[i] !== 0xFF) return false
		const marker = bytes[i + 1]
		i += 2
		if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) continue
		if (i + 1 >= bytes.length) break
		const segLen = (bytes[i] << 8) | bytes[i + 1]
		if (ALL_SOF_MARKERS.has(marker)) return PROGRESSIVE_SOF_MARKERS.has(marker)
		i += segLen
	}
	return false
}

async function getArtData(filePath: string): Promise<{ width: number; height: number; bytes: Uint8Array } | null> {
	const extract = new Deno.Command('exiftool', {
		args: ['-b', '-Picture', filePath],
		stdout: 'piped',
		stderr: 'piped',
	})
	const { stdout: picData } = await extract.output()
	if (picData.length === 0) return null

	const inspect = new Deno.Command('exiftool', {
		args: ['-json', '-ImageWidth', '-ImageHeight', '-'],
		stdin: 'piped',
		stdout: 'piped',
		stderr: 'piped',
	})
	const child = inspect.spawn()
	const writer = child.stdin.getWriter()
	await writer.write(picData)
	await writer.close()
	const { stdout } = await child.output()
	const result = JSON.parse(new TextDecoder().decode(stdout))
	const entry = result[0]
	if (!entry?.ImageWidth || !entry?.ImageHeight) return null
	return { width: entry.ImageWidth, height: entry.ImageHeight, bytes: picData }
}

export async function verify(opts: {
	root: string
	filter: string
	tags: string[]
}): Promise<boolean> {
	const { root, filter, tags } = opts

	const unknown = tags.filter((t) => !VALID_TAGS.has(t))
	if (unknown.length > 0) {
		throw new Error(`Unknown tag(s): ${unknown.join(', ')}. Valid: ${[...VALID_TAGS].join(', ')}`)
	}

	printHeader(`Verifying tags [${tags.join(', ')}] in ${root}`)

	const cmd = new Deno.Command('exiftool', {
		args: [
			'-json',
			'-r',
			'-ext',
			'mp3',
			'-ext',
			'flac',
			'-ext',
			'dsf',
			'-SourceFile',
			'-Title',
			'-Artist',
			'-Album',
			'-TrackNumber',
			'-Track',
			'-Genre',
			'-PictureWidth',
			'-PictureHeight',
			'-Picture',
			'-PictureMIMEType',
			root,
		],
		stdout: 'piped',
		stderr: 'piped',
	})

	const { code, stdout, stderr } = await cmd.output()
	if (code !== 0) {
		const errText = new TextDecoder().decode(stderr)
		throw new Error(`exiftool failed (code ${code}): ${errText}`)
	}

	let entries: ExiftoolEntry[] = []
	try {
		entries = JSON.parse(new TextDecoder().decode(stdout))
	} catch {
		throw new Error('Failed to parse exiftool JSON output')
	}

	const filtered = entries.filter((e) => {
		const lower = e.SourceFile.toLowerCase()
		const ext = lower.slice(lower.lastIndexOf('.'))
		if (!['.mp3', '.flac', '.dsf'].includes(ext)) return false
		if (filter === DEFAULT_FILTER) return true
		return matchGlob(relative(root, e.SourceFile), filter)
	})

	printInfo(`Found ${filtered.length} files`)

	let issues = 0
	const progress = new Progress(filtered.length, 'Verifying')

	for (const entry of filtered) {
		const relPath = relative(root, entry.SourceFile)
		const problems: string[] = []

		for (const tag of tags) {
			if (tag === 'art') {
				if (!entry.Picture) {
					problems.push('missing art')
					continue
				}
				let width = entry.PictureWidth
				let height = entry.PictureHeight

				const isWrongFormat = entry.PictureMIMEType != null && !isJpegMime(entry.PictureMIMEType)
				if (isWrongFormat) {
					problems.push(`art format ${entry.PictureMIMEType} is not JPEG`)
				}

				// Fetch art bytes for JPEG files (progressive check) or when dimensions are missing
				if (!isWrongFormat && (width == null || height == null || isJpegMime(entry.PictureMIMEType ?? ''))) {
					const art = await getArtData(entry.SourceFile)
					if (!art) {
						problems.push('missing art')
						continue
					}
					width = art.width
					height = art.height
					if (isProgressiveJpeg(art.bytes)) {
						problems.push('art is progressive JPEG')
					}
				}

				if (width != null && height != null && (width > ART_MAX || height > ART_MAX)) {
					problems.push(`art dimensions ${width}x${height} exceed ${ART_MAX}x${ART_MAX}`)
				}
				continue
			}
			const key = tag.charAt(0).toUpperCase() + tag.slice(1)
			const raw = tag === 'track' ? (entry['TrackNumber'] ?? entry['Track']) : entry[key]
			const value = raw != null ? String(raw).trim() : ''
			if (value === '') {
				problems.push(`missing ${tag}`)
			} else if (tag === 'genre' && !VALID_GENRES.has(value.toLowerCase())) {
				problems.push(`invalid genre: "${value}"`)
			}
		}

		if (problems.length > 0) {
			issues += problems.length
			for (const problem of problems) {
				printError(relPath, problem)
			}
		}

		progress.increment(relPath.split('/').pop() ?? '')
	}

	if (issues === 0) {
		printSuccess(`All ${filtered.length} files OK`)
	} else {
		printInfo(`Found ${issues} issue(s) across ${filtered.length} files`)
	}

	return issues === 0
}
