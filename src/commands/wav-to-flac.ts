import { walk } from '@std/fs'
import { dirname, join, relative } from '@std/path'
import { config } from '../config.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function wavToFlac(opts: { input: string; output: string; concurrency: number }): Promise<void> {
	const { input, output, concurrency } = opts

	printHeader(`Converting WAV → FLAC: ${input} → ${output}`)

	const files: string[] = []
	for await (const entry of walk(input, { includeDirs: false, exts: ['.wav'] })) {
		files.push(entry.path)
	}

	if (files.length === 0) {
		printInfo('No WAV files found')
		return
	}

	await Deno.mkdir(output, { recursive: true })

	const progress = new Progress(files.length, 'Converting')
	let errors = 0

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency)
		await Promise.all(batch.map(async (f) => {
			const rel = relative(input, f)
			const dest = join(output, rel.replace(/\.wav$/i, '.flac'))
			await Deno.mkdir(dirname(dest), { recursive: true })

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
					'-ar',
					String(config.flac.sampleRate),
					'-sample_fmt',
					config.flac.sampleFmt,
					'-c:a',
					'flac',
					'-compression_level',
					String(config.flac.compressionLevel),
					'-frame_size',
					String(config.flac.frameSize),
					'-c:v',
					'copy',
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
