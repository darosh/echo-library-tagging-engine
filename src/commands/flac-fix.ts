import { walk } from '@std/fs'
import { config } from '../config.ts'
import { printError, printHeader, printInfo, printSuccess, Progress } from '../utils/progress.ts'

export async function flacFix(opts: { dir: string; concurrency: number }): Promise<void> {
	const { dir, concurrency } = opts

	printHeader(`Fixing FLAC files in ${dir}`)

	const files: string[] = []
	for await (const entry of walk(dir, { includeDirs: false, exts: ['.flac'] })) {
		files.push(entry.path)
	}

	if (files.length === 0) {
		printInfo('No FLAC files found')
		return
	}

	const progress = new Progress(files.length, 'Checking')
	let fixed = 0
	let errors = 0

	for (let i = 0; i < files.length; i += concurrency) {
		const batch = files.slice(i, i + concurrency)
		await Promise.all(batch.map(async (f) => {
			const { stdout: blocksizeOut } = await new Deno.Command('metaflac', {
				args: ['--show-max-blocksize', f],
				stdout: 'piped',
				stderr: 'null',
			}).output()

			const blocksize = parseInt(new TextDecoder().decode(blocksizeOut).trim())
			if (blocksize <= config.flac.frameSize) {
				progress.increment(f.split('/').pop() ?? '')
				return
			}

			const tmp = f.replace(/\.flac$/i, '.fix.flac')
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
					'flac',
					'-compression_level',
					String(config.flac.compressionLevel),
					'-frame_size',
					String(config.flac.frameSize),
					'-c:v',
					'copy',
					'-y',
					tmp,
				],
				stdout: 'null',
				stderr: 'piped',
			}).output()

			if (code !== 0) {
				errors++
				printError(f, new TextDecoder().decode(stderr).trim())
				await Deno.remove(tmp).catch(() => {})
			} else {
				await Deno.rename(tmp, f)
				fixed++
				console.log(`  fixed: ${f}`)
			}

			progress.increment(f.split('/').pop() ?? '')
		}))
	}

	printSuccess(`Fixed ${fixed} files (${errors} errors)`)
}
