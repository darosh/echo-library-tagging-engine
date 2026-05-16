import { assert } from "@std/assert";

Deno.test({ name: "CLI builds without error", sanitizeResources: false }, async () => {
  const { buildCli } = await import("../src/cli.ts");
  const cli = buildCli();
  assert(cli !== undefined);
});
