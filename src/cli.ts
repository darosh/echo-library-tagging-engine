import { Command } from '@cliffy/command'
import { resolve } from '@std/path'
import { openDb } from './utils/db.ts'
import { collect, DEFAULT_FILTER } from './commands/collect.ts'
import { copy } from './commands/copy.ts'
import { analyze } from './commands/analyze.ts'
import { analyzeNative } from './commands/analyze-native.ts'
import { write } from './commands/write.ts'
import { stats } from './commands/stats.ts'
import { consolidate } from './commands/consolidate.ts'
import { parseSimplify } from './utils/simplify.ts'
import { verify } from './commands/verify.ts'
import { DEFAULT_QML_SCRIPT, resizeArt } from './commands/resize-art.ts'
import { dsfToFlac } from './commands/dsf-to-flac.ts'
import { flacCheck } from './commands/flac-check.ts'
import { flacFix } from './commands/flac-fix.ts'
import { flacToMp3 } from './commands/flac-to-mp3.ts'
import { mp4ToMp3 } from './commands/mp4-to-mp3.ts'
import { m4aToMp3 } from './commands/m4a-to-mp3.ts'
import { wmaToMp3 } from './commands/wma-to-mp3.ts'
import { wavToFlac } from './commands/wav-to-flac.ts'
import { sdCheck } from './commands/sd-check.ts'
import { sdCount } from './commands/sd-count.ts'
import { tagJanitor } from './commands/tag-janitor.ts'
import { collectLufs } from './commands/collect-lufs.ts'
import { showDb } from './commands/show.ts'
import { moodPlaylists } from './commands/mood-playlists.ts'
import denoConfig from '../deno.json' with { type: 'json' }
const { version } = denoConfig

const DEFAULT_CONCURRENCY = Math.max(2, (navigator.hardwareConcurrency || 4) - 1)
const DEFAULT_MODELS_DIR = './models'
const DEFAULT_IGNORE = 'Speech,Book,Test,Other,Sample'

function parseIgnore(value: string): string[] {
	return value.split(',').map((s) => s.trim()).filter(Boolean)
}

export function buildCli() {
	return new Command()
		.name('elite')
		.version(version)
		.description('Echo library tagging engine')
		.action(() => {
			buildCli().showHelp()
			Deno.exit(0)
		})
		.command(
			'db-collect',
			new Command()
				.description('Scan library and extract metadata via kid3 → SQLite')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--filter <glob:string>', 'Glob pattern inside root', { default: DEFAULT_FILTER })
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.option('--dry-run', 'Preview without writing to database')
				.action(async ({ input, filter, db: dbPath, concurrency, dryRun }) => {
					const db = openDb(resolve(dbPath))
					try {
						await collect({ db, root: resolve(input), filter, dryRun: dryRun ?? false, concurrency })
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-analyze',
			new Command()
				.description('Run essentia mood/genre inference on collected files → SQLite')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option('--models-dir <path:string>', 'Directory for TF.js model files', { default: DEFAULT_MODELS_DIR })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.option('--max <seconds:number>', 'Limit audio analyzed per file to this many seconds (central slice)')
				.option('--ignore <genres:string>', 'Comma-separated original genres to skip', { default: DEFAULT_IGNORE })
				.option('--runtime <rt:string>', 'ONNX runtime: native (default, faster) or wasm', { default: 'native' })
				.option('--dry-run', 'Preview without modifying database')
				.action(async ({ input, db: dbPath, modelsDir, concurrency, max, ignore, runtime, dryRun }) => {
					const db = openDb(resolve(dbPath))
					const sharedOpts = {
						db,
						root: resolve(input),
						modelsDir: resolve(modelsDir),
						concurrency,
						dryRun: dryRun ?? false,
						maxSeconds: max,
						ignore: parseIgnore(ignore),
					}
					try {
						if (runtime === 'native') {
							await analyzeNative(sharedOpts)
						} else {
							await analyze(sharedOpts)
						}
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-collect-lufs',
			new Command()
				.description('Scan album LUFS/peak/gain via rsgain → SQLite')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--filter <glob:string>', 'Glob pattern inside root', { default: DEFAULT_FILTER })
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.option('--dry-run', 'Preview without modifying database')
				.action(async ({ input, filter, db: dbPath, concurrency, dryRun }) => {
					const db = openDb(resolve(dbPath))
					try {
						await collectLufs({ db, root: resolve(input), filter, concurrency, dryRun: dryRun ?? false })
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-stats',
			new Command()
				.description('Show mood tag distribution from analysis results')
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option('--ignore <genres:string>', 'Comma-separated original genres to skip', { default: DEFAULT_IGNORE })
				.option(
					'--simplify <value:string>',
					'Simplify mood×tag combinations: number (top N), auto (detect cliff), false (disable)',
					{ default: 'auto' },
				)
				.option('--simplify-reset', 'Clear and recompute the simplify table')
				.option('--max-moods <n:number>', 'Max distinct mood categories after collapse', { default: 10 })
				.option('--top-genres <n:number>', 'Max genres after collapse', { default: 50 })
				.option('--ignore-old-genres <genres:string>', 'Comma-separated original genres to treat as unset (use detected genre instead)', {
					default: 'Other',
				})
				.action(({ db: dbPath, ignore, ignoreOldGenres, simplify, simplifyReset, maxMoods, topGenres }) => {
					const db = openDb(resolve(dbPath))
					try {
						stats({
							db,
							ignore: parseIgnore(ignore),
							ignoreOldGenres: parseIgnore(ignoreOldGenres),
							simplify: parseSimplify(simplify),
							simplifyReset: simplifyReset ?? false,
							maxMoods,
							topGenres,
						})
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-write',
			new Command()
				.description('Write Genre tag to audio files from analysis results')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option(
					'--format <template:string>',
					'Tag format string. Variables: %mood%, %original%, %simplified%. Example: "%original% | %mood%"',
					{ default: '%simplified%' },
				)
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.option('--ignore <genres:string>', 'Comma-separated original genres to skip', { default: DEFAULT_IGNORE })
				.option(
					'--simplify <value:string>',
					'Simplify mood×tag combinations: number (top N), auto (detect cliff), false (disable)',
					{ default: 'auto' },
				)
				.option('--simplify-reset', 'Clear and recompute the simplify table')
				.option('--max-moods <n:number>', 'Max distinct mood categories after collapse', { default: 10 })
				.option('--dry-run', 'Preview without modifying files')
				.action(async ({ input, db: dbPath, format, concurrency, ignore, simplify, simplifyReset, maxMoods, dryRun }) => {
					const db = openDb(resolve(dbPath))
					try {
						await write({
							db,
							root: resolve(input),
							format,
							concurrency,
							dryRun: dryRun ?? false,
							ignore: parseIgnore(ignore),
							simplify: parseSimplify(simplify),
							simplifyReset: simplifyReset ?? false,
							maxMoods,
						})
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-consolidate',
			new Command()
				.description('Write consolidated genre tags to audio files')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option('--top-genres <n:number>', 'Max genres after collapse', { default: 50 })
				.option('--ignore <genres:string>', 'Comma-separated original genres to skip', { default: DEFAULT_IGNORE })
				.option('--ignore-old-genres <genres:string>', 'Comma-separated original genres to treat as unset (use detected genre instead)', {
					default: 'Other',
				})
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.option('--dry-run', 'Preview without modifying files')
				.action(async ({ input, db: dbPath, topGenres, ignore, ignoreOldGenres, concurrency, dryRun }) => {
					const db = openDb(resolve(dbPath))
					try {
						await consolidate({
							db,
							root: resolve(input),
							topGenres,
							ignore: parseIgnore(ignore),
							ignoreOldGenres: parseIgnore(ignoreOldGenres),
							concurrency,
							dryRun: dryRun ?? false,
						})
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-show',
			new Command()
				.description('Start web visualizer for genres and moods from a database')
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.action(async ({ db: dbPath }) => {
					const db = openDb(resolve(dbPath))
					try {
						await showDb({ db })
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'db-mood-playlists',
			new Command()
				.description('Write M3U playlists grouped by mood from a database')
				.option('--db <path:string>', 'SQLite database path', { required: true })
				.option('--input <path:string>', 'Root directory of audio files', { required: true })
				.option('--output <path:string>', 'Directory to write playlists', { required: true })
				.option('--filter <glob:string>', 'Glob pattern inside input root', { default: DEFAULT_FILTER })
				.option('--max <n:number>', 'Collapse to at most N distinct moods')
				.option('--strip-track', 'Remove leading track-number prefix from filenames')
				.option('--ascii', 'Convert diacritics to ASCII in filenames')
				.action(async ({ db: dbPath, input, output, filter, max, stripTrack, ascii }) => {
					const db = openDb(resolve(dbPath))
					try {
						await moodPlaylists({
							db,
							input: resolve(input),
							output: resolve(output),
							filter,
							max,
							stripTrack: stripTrack ?? false,
							ascii: ascii ?? false,
						})
					} finally {
						db.close()
					}
				}),
		)
		.command(
			'from-dsf-to-flac',
			new Command()
				.description('Convert DSF files to FLAC at 24-bit/96kHz')
				.option('--input <path:string>', 'Input directory', { required: true })
				.option('--output <path:string>', 'Output directory', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, output, concurrency }) => {
					await dsfToFlac({ input: resolve(input), output: resolve(output), concurrency })
				}),
		)
		.command(
			'from-wav-to-flac',
			new Command()
				.description('Convert WAV files to FLAC at 24-bit/96kHz')
				.option('--input <path:string>', 'Input directory', { required: true })
				.option('--output <path:string>', 'Output directory', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, output, concurrency }) => {
					await wavToFlac({ input: resolve(input), output: resolve(output), concurrency })
				}),
		)
		.command(
			'from-flac-to-mp3',
			new Command()
				.description('Convert FLAC and DSF files to MP3 (VBR V0)')
				.option('--input <path:string>', 'Input directory', { required: true })
				.option('--output <path:string>', 'Output directory', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, output, concurrency }) => {
					await flacToMp3({ input: resolve(input), output: resolve(output), concurrency })
				}),
		)
		.command(
			'from-mp4-to-mp3',
			new Command()
				.description('Extract audio from MP4/M4A files to MP3')
				.option('--input <path:string>', 'Input directory', { required: true })
				.option('--output <path:string>', 'Output directory', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, output, concurrency }) => {
					await mp4ToMp3({ input: resolve(input), output: resolve(output), concurrency })
				}),
		)
		.command(
			'from-m4a-to-mp3',
			new Command()
				.description('Convert M4A files to MP3 (preserving bitrate)')
				.option('--input <path:string>', 'Input directory', { required: true })
				.option('--output <path:string>', 'Output directory', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, output, concurrency }) => {
					await m4aToMp3({ input: resolve(input), output: resolve(output), concurrency })
				}),
		)
		.command(
			'from-wma-to-mp3',
			new Command()
				.description('Convert WMA files to MP3')
				.option('--input <path:string>', 'Input directory', { required: true })
				.option('--output <path:string>', 'Output directory', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, output, concurrency }) => {
					await wmaToMp3({ input: resolve(input), output: resolve(output), concurrency })
				}),
		)
		.command(
			'flac-check',
			new Command()
				.description('Validate FLAC files for blocksize, sample rate, and bit depth limits')
				.option('--input <path:string>', 'Directory to check', { required: true })
				.action(async ({ input }) => {
					const ok = await flacCheck({ dir: resolve(input) })
					if (!ok) Deno.exit(1)
				}),
		)
		.command(
			'flac-fix',
			new Command()
				.description('Re-encode non-compliant FLAC files in-place with blocksize 4096')
				.option('--input <path:string>', 'Directory to fix', { required: true })
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.action(async ({ input, concurrency }) => {
					await flacFix({ dir: resolve(input), concurrency })
				}),
		)
		.command(
			'tag-verify',
			new Command()
				.description('Verify audio file tags directly from files (no database)')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--filter <glob:string>', 'Glob pattern inside root', { default: DEFAULT_FILTER })
				.option('--tags <list:string>', 'Comma-separated tags to check', { default: 'title,artist,album,track,genre' })
				.action(async ({ input, filter, tags }) => {
					const ok = await verify({
						root: resolve(input),
						filter,
						tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
					})
					if (!ok) Deno.exit(1)
				}),
		)
		.command(
			'tag-resize-art',
			new Command()
				.description('Normalize embedded album art: resize if >500px, convert non-JPEG formats and progressive JPEGs to non-progressive JPEG')
				.option('--input <path:string>', 'Library root directory', { required: true })
				.option('--filter <glob:string>', 'Glob pattern inside root', { default: DEFAULT_FILTER })
				.option('--qml-script <path:string>', 'Path to NormalizeAlbumArt.qml', {
					default: DEFAULT_QML_SCRIPT,
				})
				.option('--concurrency <n:number>', 'Parallel workers', { default: DEFAULT_CONCURRENCY })
				.option('--dry-run', 'Preview without modifying files')
				.action(async ({ input, filter, qmlScript, concurrency, dryRun }) => {
					await resizeArt({
						root: resolve(input),
						filter,
						qmlScript,
						concurrency,
						dryRun: dryRun ?? false,
					})
				}),
		)
		.command(
			'tag-janitor',
			new Command()
				.description('Strip ID3v1 and non-standard tags from audio files via kid3')
				.option('--input <path:string>', 'Root path (file or directory)', { required: true })
				.option('--sleep <ms:number>', 'Delay between folders in milliseconds', { default: 5000 })
				.action(async ({ input, sleep }) => {
					await tagJanitor({ root: resolve(input), sleepMs: sleep })
				}),
		)
		.command(
			'sd-count',
			new Command()
				.description('Count audio files per top-level folder')
				.option('--input <path:string>', 'Path to directory', { required: true })
				.option('--filter <glob:string>', 'Glob pattern to filter folders')
				.action(async ({ input, filter }) => {
					await sdCount({ target: resolve(input), filter })
				}),
		)
		.command(
			'sd-copy',
			new Command()
				.description('Copy audio files to destination in sorted order (no Mac artifacts)')
				.option('--input <path:string>', 'Source root directory', { required: true })
				.option('--filter <glob:string>', 'Glob pattern inside root', { default: DEFAULT_FILTER })
				.option('--output <path:string>', 'Destination directory', { required: true })
				.option('--overwrite', 'Overwrite existing files (default: skip)')
				.option('--dry-run', 'Preview without copying files')
				.option('--strip-track', 'Remove leading track-number prefix from filenames')
				.option('--ascii', 'Convert diacritics to ASCII in filenames')
				.action(async ({ input, filter, output, overwrite, dryRun, stripTrack, ascii }) => {
					await copy({
						root: resolve(input),
						filter,
						dest: resolve(output),
						overwrite: overwrite ?? false,
						dryRun: dryRun ?? false,
						stripTrack: stripTrack ?? false,
						ascii: ascii ?? false,
					})
				}),
		)
		.command(
			'sd-demac',
			new Command()
				.description('Clean Mac artifacts from an SD card')
				.option('--input <path:string>', 'Path to SD card', { required: true })
				.action(async ({ input }) => {
					await sdCheck({ target: resolve(input) })
				}),
		)
}
