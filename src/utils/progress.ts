import { bold, cyan, gray, green, magenta, red, yellow } from '@std/fmt/colors'

export { bold, cyan, gray, green, magenta, red, yellow }

function toHMS(seconds: number): string {
	const s = Math.floor(seconds)
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const sec = s % 60
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function printHeader(text: string): void {
	console.log(bold(cyan(`\n▶ ${text}`)))
}

export function printSuccess(text: string): void {
	console.log(green(`  ✓ ${text}`))
}

export function printError(file: string, error: string): void {
	Deno.stderr.writeSync(new TextEncoder().encode('\n'))
	console.error(red(`  ✗ ${file}\n    ${error}`))
}

export function printWarn(text: string): void {
	console.warn(yellow(`  ⚠ ${text}`))
}

export function printInfo(text: string): void {
	console.log(gray(`  · ${text}`))
}

export class Progress {
	private total: number
	private current = 0
	private startTime = Date.now()
	private label: string

	constructor(total: number, label = 'Processing') {
		this.total = total
		this.label = label
		this.render()
	}

	increment(detail = ''): void {
		this.current++
		const now = Date.now()
		if (this.current >= this.total || now - this.lastRenderTime >= 200) {
			this.lastRenderTime = now
			this.render(detail)
		}
		if (this.current >= this.total) {
			console.log('')
		}
	}

	private lastVisibleLen = 0
	private lastRenderTime = 0

	private render(detail = ''): void {
		const pct = this.total > 0 ? this.current / this.total : 0
		const width = 30
		const filled = Math.round(pct * width)
		const bar = green('█'.repeat(filled)) + gray('░'.repeat(width - filled))
		const elapsed = (Date.now() - this.startTime) / 1000
		const elapsedStr = toHMS(elapsed)
		const etaRaw = this.current > 0 ? (elapsed / this.current) * (this.total - this.current) : null
		const etaStr = etaRaw !== null ? toHMS(etaRaw) : '--:--:--'
		const suffix = detail ? ` ${detail.slice(0, 40)}` : ''
		const line = `  [${bar}] ${cyan(String(this.current))}/${this.total} ${green(elapsedStr)} ETA ${red(etaStr)} ${this.label}${suffix ? gray(suffix) : ''}`
		// visible length: brackets + bar chars + rest (no ANSI codes)
		const visibleLen = 4 + width + ` ${this.current}/${this.total} ${elapsedStr} ETA ${etaStr} ${this.label}${suffix}`.length
		const padding = ' '.repeat(Math.max(0, this.lastVisibleLen - visibleLen))
		this.lastVisibleLen = visibleLen
		Deno.stderr.writeSync(
			new TextEncoder().encode(`\r${line}${padding}`),
		)
	}
}
