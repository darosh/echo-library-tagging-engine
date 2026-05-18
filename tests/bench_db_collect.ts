interface BenchOptions {
	input: string
	dbDir: string
	runs: number
	concurrencies: number[]
}

function parseArgs(args: string[]): BenchOptions {
	let input = './temp'
	let dbDir = './db/bench-db-collect'
	let runs = 3
	const concurrencies: number[] = []

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--input') {
			input = args[++i]
		} else if (arg === '--db-dir') {
			dbDir = args[++i]
		} else if (arg === '--runs') {
			runs = Number(args[++i])
		} else if (arg === '--concurrency') {
			concurrencies.push(...parseConcurrencyList(args[++i]))
		} else if (arg === '--help' || arg === '-h') {
			printUsage()
			Deno.exit(0)
		} else {
			concurrencies.push(...parseConcurrencyList(arg))
		}
	}

	if (concurrencies.length === 0) {
		concurrencies.push(1, 2, 4, 6, 8, 9, 10, 12, 14, 16)
	}
	if (!Number.isInteger(runs) || runs < 1) {
		throw new Error('--runs must be a positive integer')
	}

	return { input, dbDir, runs, concurrencies: [...new Set(concurrencies)] }
}

function parseConcurrencyList(value: string): number[] {
	return value.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n > 0)
}

function printUsage(): void {
	console.log(`Usage:
  deno run -A tests/bench_db_collect.ts [concurrency...]

Options:
  --input <path>        Library path to benchmark. Default: ./temp
  --db-dir <path>       Directory for benchmark DBs. Default: ./db/bench-db-collect
  --runs <n>            Runs per concurrency. Default: 3
  --concurrency <list>  Comma-separated concurrency list.

Examples:
  deno run -A tests/bench_db_collect.ts
  deno run -A tests/bench_db_collect.ts --runs 5 --concurrency 4,6,8,10,12
  deno run -A tests/bench_db_collect.ts --input "$MY_LIB" 6 8 10 12
`)
}

async function runCollect(input: string, dbPath: string, concurrency: number): Promise<number> {
	await Deno.remove(dbPath).catch((err) => {
		if (!(err instanceof Deno.errors.NotFound)) throw err
	})

	const started = performance.now()
	const { code, stdout, stderr } = await new Deno.Command('deno', {
		args: [
			'run',
			'-A',
			'elite.ts',
			'db-collect',
			'--input',
			input,
			'--db',
			dbPath,
			'--concurrency',
			String(concurrency),
		],
		stdout: 'piped',
		stderr: 'piped',
	}).output()
	const elapsed = (performance.now() - started) / 1000

	if (code !== 0) {
		console.error(new TextDecoder().decode(stdout))
		console.error(new TextDecoder().decode(stderr))
		throw new Error(`db-collect failed for concurrency ${concurrency}`)
	}

	return elapsed
}

async function main(): Promise<void> {
	const opts = parseArgs(Deno.args)
	await Deno.mkdir(opts.dbDir, { recursive: true })

	console.log(`input\t${opts.input}`)
	console.log(`dbDir\t${opts.dbDir}`)
	console.log(`runs\t${opts.runs}`)
	console.log('concurrency\trun\tseconds')

	const summary: { concurrency: number; avg: number; best: number; worst: number }[] = []
	for (const concurrency of opts.concurrencies) {
		const times: number[] = []
		for (let run = 1; run <= opts.runs; run++) {
			const dbPath = `${opts.dbDir}/collect-c${concurrency}-r${run}.db`
			const elapsed = await runCollect(opts.input, dbPath, concurrency)
			times.push(elapsed)
			console.log(`${concurrency}\t${run}\t${elapsed.toFixed(3)}`)
		}
		const avg = times.reduce((sum, value) => sum + value, 0) / times.length
		summary.push({
			concurrency,
			avg,
			best: Math.min(...times),
			worst: Math.max(...times),
		})
	}

	console.log('\nsummary')
	console.log('concurrency\tavg\tbest\tworst')
	for (const row of summary.toSorted((a, b) => a.avg - b.avg)) {
		console.log(`${row.concurrency}\t${row.avg.toFixed(3)}\t${row.best.toFixed(3)}\t${row.worst.toFixed(3)}`)
	}
}

if (import.meta.main) {
	await main()
}
