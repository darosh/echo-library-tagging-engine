import { printHeader, printInfo, printSuccess } from '../utils/progress.ts'

const KID3_CLEAN_CMDS = [
	'syncto 1',
	'remove 1',
	"set '*.selected' 1",
	'set Artist.selected 0',
	'set Title.selected 0',
	'set Album.selected 0',
	'set Track.selected 0',
	"set 'Track Number'.selected 0",
	"set 'Disc Number'.selected 0",
	'set Genre.selected 0',
	'set Composer.selected 0',
	'set Date.selected 0',
	'set Picture.selected 0',
	"set 'Album Artist'.selected 0",
	"set 'General Object'.selected 0",
	'remove 2',
	'save',
]

export async function tagJanitor(opts: { root: string; sleepMs: number }): Promise<void> {
	const { root, sleepMs } = opts

	printHeader(`Tag Janitor: ${root}`)

	// Collect unique folders containing audio files
	const folderSet = new Set<string>()
	await collectAudioFolders(root, folderSet)

	const folders = [...folderSet].sort()

	if (folders.length === 0) {
		printInfo(`No audio files found in '${root}'`)
		return
	}

	printInfo(`Processing ${folders.length} folder(s)`)

	for (let idx = 0; idx < folders.length; idx++) {
		const dir = folders[idx]
		const rel = dir.replace(root + '/', '').replace(root, '.')
		console.log(`[${idx + 1} of ${folders.length}] ${rel}`)

		const files = await collectAudioFiles(dir)
		if (files.length === 0) continue

		const cmdArgs: string[] = []
		for (const cmd of KID3_CLEAN_CMDS) {
			cmdArgs.push('-c', cmd)
		}
		cmdArgs.push(...files)

		await new Deno.Command('kid3-cli', {
			args: cmdArgs,
			stdout: 'inherit',
			stderr: 'inherit',
		}).output()

		if (idx < folders.length - 1 && sleepMs > 0) {
			await new Promise((r) => setTimeout(r, sleepMs))
		}
	}

	printSuccess('Done')
}

async function collectAudioFolders(dir: string, out: Set<string>): Promise<void> {
	try {
		for await (const entry of Deno.readDir(dir)) {
			const fullPath = `${dir}/${entry.name}`
			if (entry.isDirectory) {
				await collectAudioFolders(fullPath, out)
			} else if (entry.isFile) {
				const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
				if (['.mp3', '.flac', '.dsf'].includes(ext)) {
					out.add(dir)
				}
			}
		}
	} catch { /* skip unreadable dirs */ }
}

async function collectAudioFiles(dir: string): Promise<string[]> {
	const files: string[] = []
	try {
		for await (const entry of Deno.readDir(dir)) {
			if (!entry.isFile) continue
			const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
			if (['.mp3', '.flac', '.dsf'].includes(ext)) {
				files.push(`${dir}/${entry.name}`)
			}
		}
	} catch { /* skip */ }
	return files
}
