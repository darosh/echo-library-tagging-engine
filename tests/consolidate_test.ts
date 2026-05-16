import { assertEquals } from "@std/assert";
import { tempPath, makeSineFlac, makeSineMp3 } from "./helpers.ts";
import { consolidateGenre } from "../src/genres.ts";

async function kid3Get(filePath: string, field: string, tag: string): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("kid3-cli", {
    args: ["-c", `select "${filePath}"`, "-c", `get ${field} ${tag}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`kid3-cli failed: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout).trim();
}

Deno.test({ name: "writeConsolidatedTag: sets genre in tag 2 (FLAC)", sanitizeResources: false }, async () => {
  const { writeConsolidatedTag } = await import("../src/consolidate.ts");

  const tmp = await tempPath(".flac");
  try {
    await makeSineFlac(tmp);
    await writeConsolidatedTag(tmp, "Rock");

    const genreTag2 = await kid3Get(tmp, "genre", "2");
    assertEquals(genreTag2, "Rock", "Tag 2 genre should be updated");
    console.log(`  ✓ Tag 2 genre = "${genreTag2}"`);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test({ name: "writeConsolidatedTag: sets genre in tag 2 and copies to tag 1 (MP3)", sanitizeResources: false }, async () => {
  const { writeConsolidatedTag } = await import("../src/consolidate.ts");

  const tmp = await tempPath(".mp3");
  try {
    await makeSineMp3(tmp);
    await writeConsolidatedTag(tmp, "Metal");

    const genreTag2 = await kid3Get(tmp, "genre", "2");
    assertEquals(genreTag2, "Metal", "Tag 2 genre should be updated");
    console.log(`  ✓ Tag 2 genre = "${genreTag2}"`);

    const genreTag1 = await kid3Get(tmp, "genre", "1");
    console.log(`  Tag 1 genre = "${genreTag1}"`);
    assertEquals(genreTag1, "Metal", "Tag 1 genre should match tag 2");
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test({ name: "consolidateGenre: empty originalGenre falls through to detected genre", sanitizeResources: false }, () => {
  assertEquals(consolidateGenre("", "electronic", new Set()), "Electronic");
  assertEquals(consolidateGenre("", "world", new Set()), "World Music");
  assertEquals(consolidateGenre("", "rock", new Set()), "Rock");
  console.log("  ✓ empty originalGenre uses detected genre mapping");
});
