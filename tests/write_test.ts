import { assertEquals } from "@std/assert";
import { tempPath, makeSineFlac, makeSineMp3 } from "./helpers.ts";

async function kid3Get(filePath: string, field: string, tag: string): Promise<string> {
  const { code, stdout, stderr } = await new Deno.Command("kid3-cli", {
    args: ["-c", `select "${filePath}"`, "-c", `get ${field} ${tag}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`kid3-cli failed: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout).trim();
}

Deno.test({ name: "writeTag: updates Genre and preserves other tags (FLAC)", sanitizeResources: false }, async () => {
  const { writeTag } = await import("../src/write.ts");

  const tmp = await tempPath(".flac");
  try {
    await makeSineFlac(tmp);

    await writeTag(tmp, "TestMood");

    const genre = await kid3Get(tmp, "genre", "2");
    assertEquals(genre, "TestMood", "Genre should be updated");
    console.log(`  ✓ Genre updated to "TestMood"`);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test({ name: "writeTag: updates Genre in ID3v2 and removes ID3v1 (MP3)", sanitizeResources: false }, async () => {
  const { writeTag } = await import("../src/write.ts");

  const tmp = await tempPath(".mp3");
  try {
    await makeSineMp3(tmp);

    await writeTag(tmp, "film / classical");

    const genreTag2 = await kid3Get(tmp, "genre", "2");
    console.log(`  after: Tag2 genre="${genreTag2}"`);

    const rawAfter = await Deno.readFile(tmp);
    const hasId3v1 = new TextDecoder("latin1").decode(rawAfter.slice(-128, -125)) === "TAG";
    console.log(`  ID3v1 tag present: ${hasId3v1}`);

    assertEquals(hasId3v1, false, "ID3v1 (Tag 1) should be removed");
    assertEquals(genreTag2, "film / classical", "ID3v2 (Tag 2) Genre should be updated");
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
});
