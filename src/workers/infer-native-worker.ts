/**
 * Deno Worker for native ORT inference. Each worker owns its own ORT sessions
 * and Essentia WASM instance — no shared memory, no mutex needed.
 *
 * Protocol:
 *   Main → Worker: InitMsg then ProcessMsg per file
 *   Worker → Main: ReadyMsg | ResultMsg | ErrorMsg
 */
import { inferFile, loadModels, type ModelSessions } from '../utils/infer-native.ts'

interface InitMsg {
	type: 'init'
	modelPaths: { backbone: string; moodtheme: string; genre: string; top50tags: string }
	maxSeconds?: number
}

interface ProcessMsg {
	type: 'process'
	id: number
	filePath: string
}

export interface ResultMsg {
	type: 'result'
	id: number
	moodtheme: number[]
	genre: number[]
	top50tags: number[]
}

export interface ErrorMsg {
	type: 'error'
	id: number
	message: string
}

export interface ReadyMsg {
	type: 'ready'
}

// deno-lint-ignore no-explicit-any
const ctx = self as any

let sessions: ModelSessions
let maxSeconds: number | undefined

ctx.onmessage = async (event: MessageEvent<InitMsg | ProcessMsg>) => {
	const msg = event.data

	if (msg.type === 'init') {
		sessions = await loadModels(msg.modelPaths)
		maxSeconds = msg.maxSeconds
		ctx.postMessage({ type: 'ready' } satisfies ReadyMsg)
		return
	}

	try {
		const result = await inferFile(msg.filePath, sessions, maxSeconds)
		ctx.postMessage({ type: 'result', id: msg.id, ...result } satisfies ResultMsg)
	} catch (err) {
		ctx.postMessage(
			{
				type: 'error',
				id: msg.id,
				message: err instanceof Error ? err.message : String(err),
			} satisfies ErrorMsg,
		)
	}
}
