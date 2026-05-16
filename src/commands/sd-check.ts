import { printHeader, printSuccess } from '../utils/progress.ts'

function ok(msg: string) {
	console.log(`  \x1b[32m${msg}\x1b[0m`)
}
function warn(msg: string) {
	console.log(`  \x1b[33m${msg}\x1b[0m`)
}
function info(msg: string) {
	console.log(`\x1b[1m${msg}\x1b[0m`)
}

export async function sdCheck(opts: { target: string }): Promise<void> {
	const { target } = opts

	printHeader(`Cleaning SD card: ${target}`)

	// 1. Mac artifacts
	info('Checking for Mac artifacts...')
	const artifacts: string[] = []

	await collectArtifactsRecursive(target, artifacts)

	if (artifacts.length === 0) {
		ok('0 artifacts found')
	} else {
		warn(`${artifacts.length} artifact(s) found`)
		info('Deleting artifacts...')
		let failed = 0
		for (const f of artifacts) {
			try {
				await Deno.remove(f, { recursive: true })
			} catch {
				failed++
			}
		}
		ok(failed === 0 ? 'Done' : `Done (${failed} could not be deleted — may need sudo)`)
	}

	// 2. Zero-size files
	info('Checking for zero-size files...')
	const zeroFiles: string[] = []
	await collectZeroFiles(target, zeroFiles)

	if (zeroFiles.length === 0) {
		ok('0 zero-size files found')
	} else {
		warn(`${zeroFiles.length} zero-size file(s) found`)
		for (const f of zeroFiles) console.log(`    ${f}`)
		info('Deleting zero-size files...')
		let failed = 0
		for (const f of zeroFiles) {
			try {
				await Deno.remove(f)
			} catch {
				failed++
			}
		}
		ok(failed === 0 ? 'Done' : `Done (${failed} could not be deleted)`)
	}

	// 3. Empty folders (repeat until none left)
	info('Checking for empty folders...')
	let totalEmpty = 0
	while (true) {
		const emptyDirs = await findEmptyDirs(target)
		if (emptyDirs.length === 0) break
		totalEmpty += emptyDirs.length
		for (const d of emptyDirs) {
			try {
				await Deno.remove(d)
			} catch { /* ignore */ }
		}
	}
	if (totalEmpty === 0) {
		ok('0 empty folders found')
	} else {
		warn(`${totalEmpty} empty folder(s) removed`)
		ok('Done')
	}

	// 4. Lock against future artifacts
	info('Locking SD card against future Mac artifacts...')
	try {
		await Deno.writeTextFile(`${target}/.metadata_never_index`, '')
		ok('.metadata_never_index created')
	} catch {
		warn('Could not create .metadata_never_index')
	}

	console.log('')
	printSuccess(`${target} is clean.`)
}

async function collectArtifactsRecursive(dir: string, out: string[]): Promise<void> {
	try {
		for await (const entry of Deno.readDir(dir)) {
			const fullPath = `${dir}/${entry.name}`
			if (['.DS_Store', '.Spotlight-V100', '.fseventsd', '.Trashes'].includes(entry.name) || entry.name.startsWith('._')) {
				out.push(fullPath)
			} else if (entry.isDirectory) {
				await collectArtifactsRecursive(fullPath, out)
			}
		}
	} catch { /* skip unreadable dirs */ }
}

async function collectZeroFiles(dir: string, out: string[]): Promise<void> {
	try {
		for await (const entry of Deno.readDir(dir)) {
			const fullPath = `${dir}/${entry.name}`
			if (entry.isDirectory) {
				await collectZeroFiles(fullPath, out)
			} else if (entry.isFile) {
				const stat = await Deno.stat(fullPath).catch(() => null)
				if (stat && stat.size === 0) out.push(fullPath)
			}
		}
	} catch { /* skip */ }
}

async function findEmptyDirs(dir: string): Promise<string[]> {
	const result: string[] = []
	try {
		for await (const entry of Deno.readDir(dir)) {
			if (!entry.isDirectory) continue
			const fullPath = `${dir}/${entry.name}`
			const sub = await findEmptyDirs(fullPath)
			result.push(...sub)
			const entries = []
			for await (const e of Deno.readDir(fullPath)) {
				entries.push(e)
				break
			}
			if (entries.length === 0) result.push(fullPath)
		}
	} catch { /* skip */ }
	return result
}
