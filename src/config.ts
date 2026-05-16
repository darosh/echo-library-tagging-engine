import { load } from '@std/dotenv'

await load({ export: true })

function int(key: string, fallback: number): number {
	const v = Deno.env.get(key)
	return v ? parseInt(v, 10) : fallback
}

function str(key: string, fallback: string): string {
	return Deno.env.get(key) ?? fallback
}

export const config = {
	flac: {
		sampleRate: int('FLAC_SAMPLE_RATE', 96000),
		sampleFmt: str('FLAC_SAMPLE_FMT', 's32'),
		compressionLevel: int('FLAC_COMPRESSION_LEVEL', 8),
		frameSize: int('FLAC_FRAME_SIZE', 4096),
		maxHz: int('FLAC_MAX_HZ', 192000),
		maxBits: int('FLAC_MAX_BITS', 24),
	},
	mp3: {
		dsfSampleRate: int('MP3_DSF_SAMPLE_RATE', 48000),
		vbrQuality: int('MP3_VBR_QUALITY', 0),
	},
}
