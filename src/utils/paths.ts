import { basename, extname } from '@std/path'

const TRACK_PREFIX = /^(?:\d{1,3}-\d{1,3}|\d{1,3})(?:\s*-\s*|\.\s+|\s+)/

function stripTrackStem(stem: string): string {
	const stripped = stem.replace(TRACK_PREFIX, '')
	return stripped || stem
}

function toAsciiStem(stem: string): string {
	return stem.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function parsePath(path: string): {
	root_path: string | null
	artist_path: string | null
	album_path: string | null
	file_name: string
	file_type: string
	strip_name: string
	ascii_name: string
	strip_ascii_name: string
} {
	const full = basename(path)
	const ext = extname(full)
	const file_type = ext.startsWith('.') ? ext.slice(1) : ext
	const file_name = full.slice(0, -ext.length || undefined)
	const segments = path.split('/')
	const artist_path = segments.length >= 3 ? segments[segments.length - 3] : null
	const album_path = segments.length >= 2 ? segments[segments.length - 2] : null
	const root_parts = segments.slice(0, -3)
	const root_path = root_parts.length > 0 ? root_parts.join('/') : null
	const strip_name = stripTrackStem(file_name) + ext
	const ascii_name = toAsciiStem(file_name) + ext
	const strip_ascii_name = toAsciiStem(stripTrackStem(file_name)) + ext
	return { root_path, artist_path, album_path, file_name, file_type, strip_name, ascii_name, strip_ascii_name }
}
