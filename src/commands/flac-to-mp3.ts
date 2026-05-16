import { walk } from '@std/fs'
import { dirname, join, relative } from '@std/path'
import { config } from '../config.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function flacToMp3(opts: { input: string; output: string; concurrency: number }): Promise<void> {
	const { input, output, concurrency } = opts

	printHeader(`Converting FLAC/DSF → MP3: ${input} → ${output}`)

	const files: string[] = []
	for await (const entry of walk(input, { includeDirs: false, exts: ['.flac', '.dsf'] })) {
		files.push(entry.path)
	}

	if (files.length === 0) {
		printInfo('No FLAC or DSF files found')
		return
	}

	await Deno.mkdir(output, { recursive: true })

	const progress = new Progress(files.length, 'Converting')
	let errors = 0

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency)
		await Promise.all(batch.map(async (f) => {
			const rel = relative(input, f)
			const dest = join(output, rel.replace(/\.(flac|dsf)$/i, '.mp3'))
			await Deno.mkdir(dirname(dest), { recursive: true })

			const isDsf = f.toLowerCase().endsWith('.dsf')
			const extraArgs = isDsf ? ['-ar', String(config.mp3.dsfSampleRate), '-sample_fmt', 's16p'] : []

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
					...extraArgs,
					'-c:a',
					'libmp3lame',
					'-q:a',
					String(config.mp3.vbrQuality),
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
