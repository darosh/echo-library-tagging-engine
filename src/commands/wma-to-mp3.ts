import { walk } from '@std/fs'
import { dirname, join, relative } from '@std/path'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function wmaToMp3(opts: { input: string; output: string; concurrency: number }): Promise<void> {
	const { input, output, concurrency } = opts

	printHeader(`Converting WMA → MP3: ${input} → ${output}`)

	const files: string[] = []
	for await (const entry of walk(input, { includeDirs: false, exts: ['.wma'] })) {
		files.push(entry.path)
	}

	if (files.length === 0) {
		printInfo('No WMA files found')
		return
	}

	await Deno.mkdir(output, { recursive: true })

	const progress = new Progress(files.length, 'Converting')
	let errors = 0

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency)
		await Promise.all(batch.map(async (f) => {
			const rel = relative(input, f)
			const dest = join(output, rel.replace(/\.wma$/i, '.mp3'))
			await Deno.mkdir(dirname(dest), { recursive: true })

			const bitrateArgs = await probeBitrateArgs(f)

			const { code, stderr } = await new Deno.Command('ffmpeg', {
				args: [
					'-loglevel',
					'error',
					'-i',
					f,
					'-map_metadata',
					'0',
					'-map',
					'0:a',
					'-map',
					'0:v?',
					'-c:a',
					'libmp3lame',
					...bitrateArgs,
					'-c:v',
					'copy',
					'-id3v2_version',
					'3',
					'-write_id3v1',
					'1',
					'-y',
					dest,
				],
				stdout: 'null',
				stderr: 'piped',
			}).output()

			if (code !== 0) {
				errors++
				printError(rel, new TextDecoder().decode(stderr).trim())
			}
			progress.increment(rel)
		}))
	}

	printSuccess(`Converted ${files.length - errors} files (${errors} errors)`)
}

async function probeBitrateArgs(f: string): Promise<string[]> {
	const { stdout } = await new Deno.Command('ffprobe', {
		args: [
			'-v',
			'error',
			'-select_streams',
			'a:0',
			'-show_entries',
			'stream=bit_rate',
			'-of',
			'default=noprint_wrappers=1:nokey=1',
			f,
		],
		stdout: 'piped',
		stderr: 'null',
	}).output()
	const raw = new TextDecoder().decode(stdout).trim()
	const bitrate = parseInt(raw)
	if (!bitrate || isNaN(bitrate)) return []
	return ['-b:a', `${Math.round(bitrate / 1000)}k`]
}
