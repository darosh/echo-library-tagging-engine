import { Database } from '@db/sqlite'
import { ensureDirSync } from '@std/fs'
import { basename, dirname, extname } from '@std/path'

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

export type FileStatus = 'pending' | 'done' | 'error'

export interface FileRow {
	id: number
	path: string
	mtime: number | null
	album_lufs: number | null
	album_peak: number | null
	album_gain: number | null
	mood: string | null
	genre: string | null
	tag: string | null
	genre_1: string | null
	genre_2: string | null
	title_2: string | null
	track_number_2: string | null
	artist_2: string | null
	album_artist_2: string | null
	date_2: string | null
	disc_number_2: string | null
	collect_status: FileStatus
	analyze_status: FileStatus
	write_status: FileStatus
	root_path: string | null
	artist_path: string | null
	album_path: string | null
	file_name: string | null
	file_type: string | null
	strip_name: string | null
	ascii_name: string | null
	strip_ascii_name: string | null
}

export function openDb(dbPath: string): Database {
	ensureDirSync(dirname(dbPath))
	const db = new Database(dbPath)
	db.exec('PRAGMA journal_mode=WAL')
	const cols = (db.prepare('PRAGMA table_info(files)').all() as { name: string }[]).map((r) => r.name)
	// Migrate existing DBs
	if (cols.length > 0 && !cols.includes('album_lufs')) {
		db.exec('ALTER TABLE files ADD COLUMN album_lufs REAL')
	}
	if (cols.length > 0 && !cols.includes('album_peak')) {
		db.exec('ALTER TABLE files ADD COLUMN album_peak REAL')
	}
	if (cols.length > 0 && !cols.includes('album_gain')) {
		db.exec('ALTER TABLE files ADD COLUMN album_gain REAL')
	}
	if (cols.length > 0 && !cols.includes('title_2')) {
		db.exec('ALTER TABLE files ADD COLUMN title_2 TEXT')
		db.exec('ALTER TABLE files ADD COLUMN track_number_2 TEXT')
		db.exec('ALTER TABLE files ADD COLUMN artist_2 TEXT')
		db.exec('ALTER TABLE files ADD COLUMN album_artist_2 TEXT')
		db.exec('ALTER TABLE files ADD COLUMN date_2 TEXT')
		db.exec('ALTER TABLE files ADD COLUMN disc_number_2 TEXT')
	}
	if (cols.length > 0 && !cols.includes('root_path')) {
		db.exec('ALTER TABLE files ADD COLUMN root_path TEXT')
		db.exec('ALTER TABLE files ADD COLUMN artist_path TEXT')
		db.exec('ALTER TABLE files ADD COLUMN album_path TEXT')
		db.exec('ALTER TABLE files ADD COLUMN file_name TEXT')
		db.exec('ALTER TABLE files ADD COLUMN file_type TEXT')
		db.exec('ALTER TABLE files ADD COLUMN strip_ascii_name TEXT')
	}
	if (cols.length > 0 && !cols.includes('strip_name')) {
		db.exec('ALTER TABLE files ADD COLUMN strip_name TEXT')
		db.exec('ALTER TABLE files ADD COLUMN ascii_name TEXT')
	}

	db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id               INTEGER PRIMARY KEY,
      path             TEXT UNIQUE NOT NULL,
      mtime            INTEGER,
      album_lufs       REAL,
      album_peak       REAL,
      album_gain       REAL,
      mood             TEXT,
      genre            TEXT,
      tag              TEXT,
      genre_1          TEXT,
      genre_2          TEXT,
      title_2          TEXT,
      track_number_2   TEXT,
      artist_2         TEXT,
      album_artist_2   TEXT,
      date_2           TEXT,
      disc_number_2    TEXT,
      collect_status   TEXT DEFAULT 'pending',
      analyze_status   TEXT DEFAULT 'pending',
      write_status     TEXT DEFAULT 'pending',
      root_path        TEXT,
      artist_path      TEXT,
      album_path       TEXT,
      file_name        TEXT,
      file_type        TEXT,
      strip_name       TEXT,
      ascii_name       TEXT,
      strip_ascii_name TEXT
    );
    CREATE TABLE IF NOT EXISTS simplify (
      mood TEXT NOT NULL,
      tag  TEXT NOT NULL,
      PRIMARY KEY (mood, tag)
    );
    CREATE TABLE IF NOT EXISTS mood_collapse (
      from_mood TEXT PRIMARY KEY,
      to_mood   TEXT NOT NULL
    );
  `)
	return db
}

function buildIgnoreClause(ignore: string[]): string {
	if (!ignore.length) return ''
	const placeholders = ignore.map(() => '?').join(',')
	return `AND (COALESCE(genre_2, genre_1) IS NULL OR COALESCE(genre_2, genre_1) NOT IN (${placeholders}))`
}

export function upsertFile(
	db: Database,
	path: string,
	mtime: number | null,
	genre1: string | null,
	genre2: string | null,
	title2: string | null,
	trackNumber2: string | null,
	artist2: string | null,
	albumArtist2: string | null,
	date2: string | null,
	discNumber2: string | null,
): void {
	const parsed = parsePath(path)
	db.exec(
		`INSERT INTO files (path, mtime, genre_1, genre_2, title_2, track_number_2, artist_2, album_artist_2, date_2, disc_number_2, collect_status, root_path, artist_path, album_path, file_name, file_type, strip_name, ascii_name, strip_ascii_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       mtime            = excluded.mtime,
       genre_1          = excluded.genre_1,
       genre_2          = excluded.genre_2,
       title_2          = excluded.title_2,
       track_number_2   = excluded.track_number_2,
       artist_2         = excluded.artist_2,
       album_artist_2   = excluded.album_artist_2,
       date_2           = excluded.date_2,
       disc_number_2    = excluded.disc_number_2,
       collect_status   = 'done',
       root_path        = excluded.root_path,
       artist_path      = excluded.artist_path,
       album_path       = excluded.album_path,
       file_name        = excluded.file_name,
       file_type        = excluded.file_type,
       strip_name       = excluded.strip_name,
       ascii_name       = excluded.ascii_name,
       strip_ascii_name = excluded.strip_ascii_name`,
		path,
		mtime,
		genre1,
		genre2,
		title2,
		trackNumber2,
		artist2,
		albumArtist2,
		date2,
		discNumber2,
		parsed.root_path,
		parsed.artist_path,
		parsed.album_path,
		parsed.file_name,
		parsed.file_type,
		parsed.strip_name,
		parsed.ascii_name,
		parsed.strip_ascii_name,
	)
}

export function saveAlbumLufs(
	db: Database,
	path: string,
	lufs: number,
	peak: number,
	gain: number,
): void {
	db.exec(
		`UPDATE files SET album_lufs = ?, album_peak = ?, album_gain = ? WHERE path = ?`,
		lufs,
		peak,
		gain,
		path,
	)
}

export function getFilesForLufs(db: Database): { path: string }[] {
	return db.prepare(
		`SELECT path FROM files WHERE path LIKE '%.mp3' AND album_lufs IS NULL`,
	).all() as { path: string }[]
}

export function getPendingForAnalysis(db: Database, ignore: string[] = []): FileRow[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT * FROM files WHERE (analyze_status = 'pending' OR analyze_status = 'error') ${clause}`,
	).all(...ignore) as FileRow[]
}

export function getPendingForWrite(db: Database, ignore: string[] = []): FileRow[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT * FROM files WHERE (write_status = 'pending' OR write_status = 'error') AND mood IS NOT NULL ${clause}`,
	).all(...ignore) as FileRow[]
}

export function saveAnalysis(
	db: Database,
	fileId: number,
	mood: string,
	genre: string,
	tag: string,
): void {
	db.exec(
		`UPDATE files SET mood = ?, genre = ?, tag = ?, analyze_status = 'done' WHERE id = ?`,
		mood,
		genre,
		tag,
		fileId,
	)
}

export function setAnalyzeError(db: Database, fileId: number): void {
	db.exec(`UPDATE files SET analyze_status = 'error' WHERE id = ?`, fileId)
}

export function setWriteDone(db: Database, fileId: number): void {
	db.exec(`UPDATE files SET write_status = 'done' WHERE id = ?`, fileId)
}

export function setWriteError(db: Database, fileId: number): void {
	db.exec(`UPDATE files SET write_status = 'error' WHERE id = ?`, fileId)
}

export function getMoodStats(db: Database, ignore: string[] = []): { mood: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT mood, COUNT(*) as count FROM files WHERE mood IS NOT NULL ${clause} GROUP BY mood ORDER BY count DESC`,
	).all(...ignore) as { mood: string; count: number }[]
}

export function getCollectedGenreStats(db: Database, ignore: string[] = []): { genre: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT COALESCE(genre_2, genre_1) as genre, COUNT(*) as count FROM files WHERE COALESCE(genre_2, genre_1) IS NOT NULL ${clause} GROUP BY COALESCE(genre_2, genre_1) ORDER BY count DESC`,
	).all(...ignore) as { genre: string; count: number }[]
}

export function getGenreStats(db: Database, ignore: string[] = []): { genre: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT genre, COUNT(*) as count FROM files WHERE genre IS NOT NULL ${clause} GROUP BY genre ORDER BY count DESC`,
	).all(...ignore) as { genre: string; count: number }[]
}

export function getTagStats(db: Database, ignore: string[] = []): { tag: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT tag, COUNT(*) as count FROM files WHERE tag IS NOT NULL ${clause} GROUP BY tag ORDER BY count DESC`,
	).all(...ignore) as { tag: string; count: number }[]
}

export function getMoodGenreStats(db: Database, ignore: string[] = []): { mood: string; genre: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT mood, genre, COUNT(*) as count FROM files WHERE mood IS NOT NULL AND genre IS NOT NULL ${clause} GROUP BY mood, genre ORDER BY count DESC`,
	).all(...ignore) as { mood: string; genre: string; count: number }[]
}

export function getMoodTagStats(db: Database, ignore: string[] = []): { mood: string; tag: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT mood, tag, COUNT(*) as count FROM files WHERE mood IS NOT NULL AND tag IS NOT NULL ${clause} GROUP BY mood, tag ORDER BY count DESC`,
	).all(...ignore) as { mood: string; tag: string; count: number }[]
}

export function getGenreTagStats(db: Database, ignore: string[] = []): { genre: string; tag: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT genre, tag, COUNT(*) as count FROM files WHERE genre IS NOT NULL AND tag IS NOT NULL ${clause} GROUP BY genre, tag ORDER BY count DESC`,
	).all(...ignore) as { genre: string; tag: string; count: number }[]
}

export function getCollectedGenreByGenreStats(db: Database, ignore: string[] = []): { original_genre: string; genre: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT COALESCE(genre_2, genre_1) as original_genre, genre, COUNT(*) as count FROM files WHERE COALESCE(genre_2, genre_1) IS NOT NULL AND genre IS NOT NULL ${clause} GROUP BY COALESCE(genre_2, genre_1), genre ORDER BY count DESC`,
	).all(...ignore) as { original_genre: string; genre: string; count: number }[]
}

export function getFilesForConsolidate(
	db: Database,
	ignore: string[] = [],
): { id: number; path: string; original_genre: string; genre: string }[] {
	const clause = buildIgnoreClause(ignore)
	return db.prepare(
		`SELECT id, path, COALESCE(COALESCE(genre_2, genre_1), '') as original_genre, genre FROM files
     WHERE genre IS NOT NULL ${clause}`,
	).all(...ignore) as { id: number; path: string; original_genre: string; genre: string }[]
}

export function getTotalFiles(db: Database): number {
	const row = db.prepare(`SELECT COUNT(*) as n FROM files`).get() as { n: number }
	return row.n
}

export function clearSimplify(db: Database): void {
	db.exec('DELETE FROM simplify')
	db.exec('DELETE FROM mood_collapse')
}

export function getMoodCollapseMap(db: Database): Map<string, string> {
	const rows = db.prepare(`SELECT from_mood, to_mood FROM mood_collapse`).all() as { from_mood: string; to_mood: string }[]
	return new Map(rows.map((r) => [r.from_mood, r.to_mood]))
}

export function setMoodCollapseMap(db: Database, map: Map<string, string>): void {
	db.exec('DELETE FROM mood_collapse')
	const stmt = db.prepare('INSERT INTO mood_collapse (from_mood, to_mood) VALUES (?, ?)')
	for (const [from, to] of map) {
		stmt.run(from, to)
	}
}

export function getSimplifyRows(db: Database): { mood: string; tag: string }[] {
	return db.prepare(`SELECT mood, tag FROM simplify`).all() as { mood: string; tag: string }[]
}

export function setSimplifyRows(db: Database, rows: { mood: string; tag: string }[]): void {
	db.exec('DELETE FROM simplify')
	const stmt = db.prepare('INSERT INTO simplify (mood, tag) VALUES (?, ?)')
	for (const { mood, tag } of rows) {
		stmt.run(mood, tag)
	}
}

export function getSimplifiedGenreTagStats(
	db: Database,
	ignore: string[] = [],
): { label: string; count: number }[] {
	const clause = buildIgnoreClause(ignore)

	const named = db.prepare(
		`SELECT f.mood || ' / ' || f.tag AS label, COUNT(*) as count
     FROM files f
     INNER JOIN simplify s ON s.mood = f.mood AND s.tag = f.tag
     WHERE f.mood IS NOT NULL AND f.tag IS NOT NULL ${clause}
     GROUP BY f.mood, f.tag
     ORDER BY count DESC`,
	).all(...ignore) as { label: string; count: number }[]

	const collapsed = db.prepare(
		`SELECT COALESCE(mc.to_mood, f.mood) AS label, COUNT(*) as count
     FROM files f
     LEFT JOIN mood_collapse mc ON mc.from_mood = f.mood
     WHERE f.mood IS NOT NULL AND f.tag IS NOT NULL ${clause}
       AND NOT EXISTS (SELECT 1 FROM simplify s WHERE s.mood = f.mood AND s.tag = f.tag)
     GROUP BY COALESCE(mc.to_mood, f.mood)
     ORDER BY count DESC`,
	).all(...ignore) as { label: string; count: number }[]

	return [...named, ...collapsed]
}

export function getFilesWithMood(
	db: Database,
): { path: string; mood: string; file_name: string; strip_name: string | null; ascii_name: string | null; strip_ascii_name: string | null }[] {
	return db.prepare(
		`SELECT path, mood, file_name, strip_name, ascii_name, strip_ascii_name FROM files WHERE mood IS NOT NULL AND analyze_status = 'done'`,
	).all() as { path: string; mood: string; file_name: string; strip_name: string | null; ascii_name: string | null; strip_ascii_name: string | null }[]
}

export function getSimplifiedGenreTagStatsSorted(
	db: Database,
	ignore: string[] = [],
): { label: string; count: number }[] {
	return getSimplifiedGenreTagStats(db, ignore).sort((a, b) => b.count - a.count)
}

export function getSimplifiedGenreTagStatsAlphabetical(
	db: Database,
	ignore: string[] = [],
): { label: string; count: number }[] {
	return getSimplifiedGenreTagStats(db, ignore).sort((a, b) => a.label.localeCompare(b.label))
}

export function getGenre2Counts(db: Database): { value: string; count: number }[] {
	return db.prepare(
		`SELECT genre_2 as value, COUNT(*) as count FROM files WHERE genre_2 IS NOT NULL AND genre_2 != '' GROUP BY genre_2 ORDER BY count DESC`,
	).all() as { value: string; count: number }[]
}

export function getMoodCounts(db: Database): { value: string; count: number }[] {
	return db.prepare(
		`SELECT mood as value, COUNT(*) as count FROM files WHERE mood IS NOT NULL GROUP BY mood ORDER BY count DESC`,
	).all() as { value: string; count: number }[]
}

export function getTagCounts(db: Database): { value: string; count: number }[] {
	return db.prepare(
		`SELECT tag as value, COUNT(*) as count FROM files WHERE tag IS NOT NULL GROUP BY tag ORDER BY count DESC`,
	).all() as { value: string; count: number }[]
}

export function getGenreCounts(db: Database): { value: string; count: number }[] {
	return db.prepare(
		`SELECT genre as value, COUNT(*) as count FROM files WHERE genre IS NOT NULL GROUP BY genre ORDER BY count DESC`,
	).all() as { value: string; count: number }[]
}

export function lookupSimplified(
	db: Database,
	mood: string,
	tag: string,
): string {
	const inSimplify = db.prepare(
		`SELECT mood FROM simplify WHERE mood = ? AND tag = ?`,
	).get(mood, tag) as { mood: string } | undefined
	if (inSimplify) return `${mood} / ${tag}`
	const collapsed = db.prepare(
		`SELECT to_mood FROM mood_collapse WHERE from_mood = ?`,
	).get(mood) as { to_mood: string } | undefined
	return collapsed ? collapsed.to_mood : mood
}
