import { dirname, fromFileUrl, relative } from '@std/path'
import { DEFAULT_FILTER, matchGlob } from './collect.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

const ART_MAX = 500
export const DEFAULT_QML_SCRIPT = fromFileUrl(new URL('../qml/NormalizeAlbumArt.qml', import.meta.url))

interface ExiftoolEntry {
	SourceFile: string
	PictureWidth?: number
	PictureHeight?: number
	Picture?: string
	PictureMIMEType?: string
	[key: string]: unknown
}

const PROGRESSIVE_SOF_MARKERS = new Set([0xC2, 0xC6, 0xCA, 0xCE])
const ALL_SOF_MARKERS = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF])

// Walk the JPEG marker chain rather than raw-scanning bytes, to avoid false
// positives from entropy-coded data that happens to contain 0xFF 0xC2.
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

function isJpegMime(mime: string): boolean {
	const m = mime.toLowerCase()
	return m === 'image/jpeg' || m === 'image/jpg' || m === 'jpg' || m === 'jpeg'
}

// PNG files stored by some taggers are missing the 8-byte PNG signature and
// one leading null byte of the IHDR chunk length. Detect and reconstruct.
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

function reconstructPng(bytes: Uint8Array): Uint8Array | null {
	// Standard PNG: signature at 0, IHDR chunk len at 8, "IHDR" at 12
	if (bytes.length > 12 && bytes[8] === 0x49 && bytes[9] === 0x48 && bytes[10] === 0x44 && bytes[11] === 0x52) {
		const full = new Uint8Array(PNG_SIG.length + bytes.length)
		full.set(PNG_SIG)
		full.set(bytes, PNG_SIG.length)
		return full
	}
	// Missing sig + 1 byte of IHDR chunk length: "IHDR" appears at offset 3
	if (bytes.length > 6 && bytes[3] === 0x49 && bytes[4] === 0x48 && bytes[5] === 0x44 && bytes[6] === 0x52) {
		const prefix = new Uint8Array([...PNG_SIG, 0x00])
		const full = new Uint8Array(prefix.length + bytes.length)
		full.set(prefix)
		full.set(bytes, prefix.length)
		return full
	}
	return null
}

async function getArtBytes(filePath: string): Promise<Uint8Array | null> {
	const { stdout } = await new Deno.Command('exiftool', {
		args: ['-b', '-Picture', filePath],
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	return stdout.length > 0 ? stdout : null
}

async function getArtData(filePath: string): Promise<{ width: number; height: number; bytes: Uint8Array } | null> {
	const picData = await getArtBytes(filePath)
	if (!picData) return null

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

// Convert non-JPEG art to JPEG using sips, then write back via mutagen.
// Returns true if conversion succeeded.
async function convertToJpeg(filePath: string, artBytes: Uint8Array): Promise<boolean> {
	const tmpIn = await Deno.makeTempFile({ suffix: '.png' })
	const tmpOut = await Deno.makeTempFile({ suffix: '.jpg' })
	try {
		// Determine if input is already JPEG (check SOI marker on raw or reconstructed bytes)
		const reconstructed = reconstructPng(artBytes)
		const isJpeg = artBytes[0] === 0xFF && artBytes[1] === 0xD8

		let converted = false

		if (isJpeg) {
			// For JPEG: use ImageMagick which re-encodes as baseline (non-progressive).
			// sips preserves the original interlacing when converting JPEG→JPEG.
			await Deno.writeFile(tmpIn, artBytes)
			const result = await new Deno.Command('magick', {
				args: [tmpIn, '-interlace', 'None', tmpOut],
				stdout: 'piped',
				stderr: 'piped',
			}).output()
			converted = result.code === 0
		} else {
			// For non-JPEG (PNG etc): try raw bytes then reconstructed header via sips
			const candidates = [artBytes, reconstructed].filter((b): b is Uint8Array => b != null)
			for (const bytes of candidates) {
				await Deno.writeFile(tmpIn, bytes)
				const result = await new Deno.Command('sips', {
					args: ['-s', 'format', 'jpeg', tmpIn, '--out', tmpOut],
					stdout: 'piped',
					stderr: 'piped',
				}).output()
				if (result.code === 0) {
					converted = true
					break
				}
			}
		}
		if (!converted) return false

		// Write converted JPEG back via mutagen (handles ID3 APIC MIME type correctly)
		const py = `
import sys
from pathlib import Path
path, jpg = sys.argv[1], sys.argv[2]
data = Path(jpg).read_bytes()
ext = Path(path).suffix.lower()
if ext in ('.mp3',):
    from mutagen.id3 import ID3, APIC
    tags = ID3(path)
    for k in [k for k in tags if k.startswith('APIC')]: tags.delall(k)
    tags.add(APIC(encoding=3, mime='image/jpeg', type=3, desc='Cover', data=data))
    tags.save()
elif ext == '.flac':
    from mutagen.flac import FLAC, Picture
    tags = FLAC(path)
    tags.clear_pictures()
    pic = Picture()
    pic.type = 3; pic.mime = 'image/jpeg'; pic.desc = 'Cover'; pic.data = data
    tags.add_picture(pic)
    tags.save()
`
		const write = await new Deno.Command('python3', {
			args: ['-c', py, filePath, tmpOut],
			stdout: 'piped',
			stderr: 'piped',
		}).output()
		return write.code === 0
	} finally {
		await Deno.remove(tmpIn).catch(() => {})
		await Deno.remove(tmpOut).catch(() => {})
	}
}

export async function resizeArt(opts: {
	root: string
	filter: string
	qmlScript: string
	concurrency: number
	dryRun: boolean
}): Promise<boolean> {
	const { root, filter, qmlScript, concurrency, dryRun } = opts

	try {
		await Deno.stat(qmlScript)
	} catch {
		throw new Error(`QML script not found: ${qmlScript}`)
	}

	printHeader(`Scanning art dimensions in ${root}`)

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

	// convertFiles: non-JPEG format or progressive JPEG → sips + mutagen path
	// oversizedDirs: oversized non-progressive JPEG → QML resize path
	const convertFiles: Array<{ path: string; reason: string }> = []
	const oversizedDirs = new Set<string>()
	const progress = new Progress(filtered.length, 'Scanning')

	for (let i = 0; i < filtered.length; i += concurrency) {
		const batch = filtered.slice(i, i + concurrency)
		await Promise.all(batch.map(async (entry) => {
			const relPath = relative(root, entry.SourceFile)
			let width = entry.PictureWidth
			let height = entry.PictureHeight

			const isWrongFormat = entry.PictureMIMEType != null && !isJpegMime(entry.PictureMIMEType)

			if (isWrongFormat) {
				if (dryRun) printError(relPath, `art format ${entry.PictureMIMEType} is not JPEG`)
				convertFiles.push({ path: entry.SourceFile, reason: entry.PictureMIMEType! })
			} else if (entry.Picture) {
				const art = await getArtData(entry.SourceFile)
				if (art) {
					width = art.width
					height = art.height
					const isOversized = width > ART_MAX || height > ART_MAX
					const isProgressive = isProgressiveJpeg(art.bytes)
					if (isProgressive) {
						// Progressive JPEG: the QML only re-encodes when resizing, so
						// non-oversized progressive files would be skipped. Route all
						// progressive files through sips+mutagen which always re-encodes.
						if (dryRun) {
							if (isOversized) printError(relPath, `art ${width}x${height} exceeds ${ART_MAX}x${ART_MAX}`)
							printError(relPath, 'art is progressive JPEG')
						}
						convertFiles.push({ path: entry.SourceFile, reason: 'progressive JPEG' })
					} else if (isOversized) {
						if (dryRun) printError(relPath, `art ${width}x${height} exceeds ${ART_MAX}x${ART_MAX}`)
						oversizedDirs.add(dirname(entry.SourceFile))
					}
				}
			}

			progress.increment(relPath.split('/').pop() ?? '')
		}))
	}

	const hasIssues = convertFiles.length > 0 || oversizedDirs.size > 0

	if (!hasIssues) {
		printSuccess('All art is compatible')
		return true
	}

	if (convertFiles.length > 0) {
		printInfo(`${dryRun ? 'Would convert' : 'Converting'} ${convertFiles.length} file${convertFiles.length === 1 ? '' : 's'} to non-progressive JPEG`)
	}
	if (oversizedDirs.size > 0) {
		printInfo(`${dryRun ? 'Would resize' : 'Resizing'} art in ${oversizedDirs.size} director${oversizedDirs.size === 1 ? 'y' : 'ies'}`)
	}

	if (dryRun) return false

	// Convert non-JPEG and progressive JPEG files via sips + mutagen
	for (let i = 0; i < convertFiles.length; i += concurrency) {
		const batch = convertFiles.slice(i, i + concurrency)
		await Promise.all(batch.map(async ({ path, reason }) => {
			const relPath = relative(root, path)
			const bytes = await getArtBytes(path)
			if (!bytes) {
				printError(relPath, `could not extract art for conversion`)
				return
			}
			const ok = await convertToJpeg(path, bytes)
			if (ok) {
				printInfo(`Converted (${reason}) in ${relPath}`)
			} else {
				printError(relPath, `failed to convert art: ${reason}`)
			}
		}))
	}

	// Normalize JPEG files (resize / progressive) via kid3 QML
	for (const dir of oversizedDirs) {
		// Escape path for kid3-cli's command parser: wrap in double quotes,
		// escape any double quotes inside the path. NFC normalization matches
		// what kid3-cli expects (same fix used for genre writes in consolidate.ts).
		const normalizedDir = dir.normalize('NFC')
		const escapedDir = `"${normalizedDir.replace(/"/g, '\\"')}"`
		const result = await new Deno.Command('kid3-cli', {
			args: ['-c', `cd ${escapedDir}`, '-c', `execute @qml ${qmlScript}`],
			stdout: 'piped',
			stderr: 'piped',
		}).output()

		const output = new TextDecoder().decode(result.stdout) +
			new TextDecoder().decode(result.stderr)
		for (const line of output.split('\n')) {
			if (line.startsWith('Normalized') || line.startsWith('Resized')) {
				printInfo(line)
			}
		}
	}

	printSuccess('Done')
	return true
}
