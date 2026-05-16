import { ensureDir } from "@std/fs";

const TEMP_DIR = new URL("../temp", import.meta.url).pathname;

export async function tempPath(suffix: string): Promise<string> {
  await ensureDir(TEMP_DIR);
  return `${TEMP_DIR}/test-${crypto.randomUUID()}${suffix}`;
}

export async function makeSineFlac(dest: string, durationSecs = 3): Promise<void> {
  const { code, stderr } = await new Deno.Command("ffmpeg", {
    args: [
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSecs}`,
      "-ar", "44100", "-c:a", "flac", "-y", dest,
    ],
    stdout: "null", stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`ffmpeg sine FLAC failed: ${new TextDecoder().decode(stderr)}`);
}

export async function makeSineMp3(dest: string, durationSecs = 3): Promise<void> {
  const { code, stderr } = await new Deno.Command("ffmpeg", {
    args: [
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSecs}`,
      "-ar", "44100", "-codec:a", "libmp3lame", "-qscale:a", "2", "-y", dest,
    ],
    stdout: "null", stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`ffmpeg sine MP3 failed: ${new TextDecoder().decode(stderr)}`);
}

export async function makeSineDsf(dest: string, durationSecs = 3): Promise<void> {
  const { code, stderr } = await new Deno.Command("ffmpeg", {
    args: [
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${durationSecs}`,
      "-c:a", "dsd_lsbf_planar", "-y", dest,
    ],
    stdout: "null", stderr: "piped",
  }).output();
  if (code !== 0) throw new Error(`ffmpeg sine DSF failed: ${new TextDecoder().decode(stderr)}`);
}
