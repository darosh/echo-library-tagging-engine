import { walk } from '@std/fs'
import { config } from '../config.ts'
import { printHeader, printInfo, printSuccess } from '../utils/progress.ts'

export async function flacCheck(opts: { dir: string }): Promise<boolean> {
	const { dir } = opts

	printHeader(`Checking FLAC files in ${dir}`)

	const files: string[] = []
	for await (const entry of walk(dir, { includeDirs: false, exts: ['.flac'] })) {
		files.push(entry.path)
	}

	if (files.length === 0) {
		printInfo('No FLAC files found')
		return true
	}

	let failures = 0

	for (const f of files) {
		const { stdout } = await new Deno.Command('metaflac', {
			args: ['--show-max-blocksize', '--show-sample-rate', '--show-bps', f],
			stdout: 'piped',
			stderr: 'null',
		}).output()

		const lines = new TextDecoder().decode(stdout).trim().split('\n')
		const blocksize = parseInt(lines[0] ?? '0')
		const hz = parseInt(lines[1] ?? '0')
		const bits = parseInt(lines[2] ?? '0')

		const errs: string[] = []
		if (blocksize > config.flac.frameSize) errs.push(`blocksize=${blocksize} > ${config.flac.frameSize}`)
		if (hz > config.flac.maxHz) errs.push(`hz=${hz} > ${config.flac.maxHz}`)
		if (bits > config.flac.maxBits) errs.push(`bits=${bits} > ${config.flac.maxBits}`)

		if (errs.length > 0) {
			console.log(`FAIL: ${f}`)
			for (const e of errs) console.log(`      ${e}`)
			failures++
		}
	}

	if (failures === 0) {
		printSuccess('All FLAC files pass')
		return true
	} else {
		console.log(`\n${failures} file(s) failed`)
		return false
	}
}
