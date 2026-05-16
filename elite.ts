import { buildCli } from './src/cli.ts'

if (import.meta.main) {
	await buildCli().parse(Deno.args)
}
