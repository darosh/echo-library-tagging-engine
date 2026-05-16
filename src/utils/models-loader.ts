import { join } from '@std/path'
import { ensureDir, exists } from '@std/fs'
import { printInfo } from './progress.ts'

const BASE = 'https://essentia.upf.edu/models/'

const MODELS = {
	backbone: 'feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.onnx',
	moodtheme: 'classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.onnx',
	genre: 'classification-heads/mtg_jamendo_genre/mtg_jamendo_genre-discogs-effnet-1.onnx',
	top50tags: 'classification-heads/mtg_jamendo_top50tags/mtg_jamendo_top50tags-discogs-effnet-1.onnx',
} as const

// Classification heads that have a companion .json with a "classes" array
const HEADS = ['moodtheme', 'genre', 'top50tags'] as const
type Head = typeof HEADS[number]

export interface ModelPaths {
	backbone: string
	moodtheme: string
	genre: string
	top50tags: string
	classes: Record<Head, string[]>
}

async function downloadFile(url: string, dest: string): Promise<void> {
	const resp = await fetch(url)
	if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`)
	await Deno.writeFile(dest, new Uint8Array(await resp.arrayBuffer()))
}

export async function ensureModels(modelsDir: string): Promise<ModelPaths> {
	await ensureDir(modelsDir)

	// Download ONNX files
	const paths: Partial<Record<keyof typeof MODELS, string>> = {}
	for (const [key, path] of Object.entries(MODELS) as [keyof typeof MODELS, string][]) {
		const filename = path.split('/').pop()!
		const dest = join(modelsDir, filename)
		if (!await exists(dest)) {
			printInfo(`Downloading ${key}: ${filename}`)
			await downloadFile(BASE + path, dest)
		}
		paths[key] = dest
	}

	// Download JSON metadata for classification heads and read classes
	const classes = {} as Record<Head, string[]>
	for (const head of HEADS) {
		const onnxPath = MODELS[head]
		const jsonPath = onnxPath.replace(/\.onnx$/, '.json')
		const jsonFilename = jsonPath.split('/').pop()!
		const dest = join(modelsDir, jsonFilename)
		if (!await exists(dest)) {
			printInfo(`Downloading ${head} metadata: ${jsonFilename}`)
			await downloadFile(BASE + jsonPath, dest)
		}
		const meta = JSON.parse(await Deno.readTextFile(dest))
		classes[head] = meta.classes as string[]
	}

	return {
		backbone: paths.backbone!,
		moodtheme: paths.moodtheme!,
		genre: paths.genre!,
		top50tags: paths.top50tags!,
		classes,
	}
}
