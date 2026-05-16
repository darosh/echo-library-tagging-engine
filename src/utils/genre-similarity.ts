// Russell circumplex: [valence (-1..1), arousal (-1..1)]
export const GENRE_SIMILARITY: Record<string, [number, number]> = {
	'': [0.0, 0.0],
	'A Cappella': [0.4, -0.2],
	'Abstract': [-0.1, -0.4],
	'Acid': [0.1, 0.6],
	'Acid Jazz': [0.4, 0.5],
	'Acid Punk': [-0.3, 0.7],
	'Acoustic': [0.5, -0.5],
	'Alternative': [0.1, 0.4],
	'Alternative Rock': [0.0, 0.5],
	'Ambient': [0.0, -0.85],
	'Anime': [0.4, 0.4],
	'Art Rock': [0.2, 0.3],
	'Audio Theatre': [0.1, -0.3],
	'Audiobook': [0.0, -0.6],
	'Avant-Garde': [-0.2, 0.2],
	'Ballad': [0.2, -0.6],
	'Baroque': [0.3, -0.1],
	'Bass': [0.2, 0.7],
	'Beat Music': [0.3, 0.6],
	'Bebop': [0.3, 0.4],
	'Bhangra': [0.7, 0.8],
	'Big Band': [0.6, 0.5],
	'Big Beat': [0.4, 0.75],
	'Black Metal': [-0.8, 0.75],
	'Bluegrass': [0.6, 0.4],
	'Blues': [-0.3, -0.2],
	'Booty Bass': [0.5, 0.8],
	'Breakbeat': [0.2, 0.8],
	'Britpop': [0.4, 0.5],
	'Cabaret': [0.5, 0.2],
	'Celtic': [0.5, 0.2],
	'Chamber Music': [0.3, -0.4],
	'Chanson': [0.3, -0.3],
	'Chillout': [0.4, -0.75],
	'Chorus': [0.5, 0.1],
	'Christian Gangsta Rap': [-0.1, 0.6],
	'Christian Rap': [0.3, 0.5],
	'Christian Rock': [0.4, 0.6],
	'Classic Rock': [0.4, 0.5],
	'Classical': [0.2, -0.3],
	'Club': [0.5, 0.85],
	'Club-House': [0.5, 0.8],
	'Comedy': [0.7, 0.4],
	'Contemporary Christian': [0.6, 0.3],
	'Country': [0.4, -0.1],
	'Crossover': [0.3, 0.4],
	'Cult': [-0.2, 0.3],
	'Dance': [0.6, 0.85],
	'Dancehall': [0.6, 0.7],
	'Dark Wave': [-0.6, -0.3],
	'Death Metal': [-0.7, 0.85],
	'Disco': [0.7, 0.75],
	'Downtempo': [0.2, -0.6],
	'Dream': [0.3, -0.65],
	'Drum & Bass': [0.1, 0.9],
	'Drum Solo': [0.2, 0.6],
	'Dub': [0.1, -0.2],
	'Dubstep': [-0.2, 0.75],
	'Duet': [0.4, -0.2],
	'EBM': [-0.3, 0.7],
	'Easy Listening': [0.5, -0.6],
	'Eclectic': [0.1, 0.0],
	'Electro': [0.2, 0.7],
	'Electroclash': [0.1, 0.6],
	'Electronic': [0.2, 0.6],
	'Emo': [-0.5, 0.4],
	'Ethnic': [0.3, 0.2],
	'Euro House': [0.6, 0.8],
	'Eurodance': [0.65, 0.8],
	'Eurotechno': [0.3, 0.75],
	'Experimental': [-0.2, 0.1],
	'Fast Fusion': [0.3, 0.7],
	'Folk': [0.4, -0.4],
	'Folk Rock': [0.4, 0.2],
	'Folklore': [0.5, -0.3],
	'Freestyle': [0.5, 0.6],
	'Funk': [0.6, 0.6],
	'Fusion': [0.3, 0.4],
	'G-Funk': [0.4, 0.5],
	'Game': [0.4, 0.6],
	'Gangsta': [-0.2, 0.6],
	'Garage': [0.2, 0.65],
	'Garage Rock': [0.1, 0.7],
	'Global': [0.4, 0.3],
	'Goa': [0.4, 0.8],
	'Gospel': [0.7, 0.4],
	'Gothic': [-0.6, 0.2],
	'Gothic Rock': [-0.5, 0.4],
	'Grunge': [-0.4, 0.6],
	'Hard Rock': [0.1, 0.8],
	'Hardcore': [-0.3, 0.85],
	'Heavy Metal': [-0.4, 0.8],
	'Hip Hop': [0.2, 0.6],
	'House': [0.55, 0.8],
	'Humour': [0.65, 0.4],
	'IDM': [0.0, 0.3],
	'Illbient': [-0.3, -0.4],
	'Indie': [0.2, 0.3],
	'Indie Rock': [0.2, 0.5],
	'Industrial': [-0.4, 0.7],
	'Industro-Goth': [-0.6, 0.5],
	'Instrumental': [0.1, -0.2],
	'Instrumental Pop': [0.4, -0.1],
	'Instrumental Rock': [0.2, 0.4],
	'Jam Band': [0.4, 0.5],
	'Jazz': [0.3, 0.1],
	'Jazz-Funk': [0.5, 0.4],
	'Jpop': [0.6, 0.5],
	'Jungle': [0.3, 0.85],
	'Krautrock': [0.1, 0.4],
	'Latin': [0.6, 0.6],
	'Leftfield': [-0.1, 0.2],
	'Lo-Fi': [0.1, -0.5],
	'Lounge': [0.5, -0.5],
	'Math Rock': [0.0, 0.6],
	'Meditative': [0.2, -0.85],
	'Merengue': [0.65, 0.7],
	'Metal': [-0.5, 0.8],
	'Musical': [0.5, 0.3],
	'National Folk': [0.5, -0.2],
	'Native American': [0.3, -0.4],
	'Neoclassical': [0.2, -0.3],
	'Neue Deutsche Welle': [0.2, 0.5],
	'New Age': [0.4, -0.7],
	'New Romantic': [0.5, 0.3],
	'New Wave': [0.3, 0.5],
	'Noise': [-0.4, 0.4],
	'Nu-Breakz': [0.2, 0.75],
	'Oldies': [0.5, 0.0],
	'Opera': [0.3, 0.4],
	'Other': [0.0, 0.0],
	'Podcast': [0.0, -0.4],
	'Polka': [0.6, 0.5],
	'Polsk Punk': [-0.2, 0.7],
	'Pop': [0.65, 0.5],
	'Pop-Folk': [0.5, -0.1],
	'Pop-Funk': [0.6, 0.5],
	'Porn Groove': [0.4, 0.3],
	'Post-Punk': [-0.2, 0.5],
	'Post-Rock': [-0.1, -0.3],
	'Power Ballad': [0.4, 0.3],
	'Pranks': [0.6, 0.4],
	'Primus': [0.1, 0.6],
	'Progressive Rock': [0.2, 0.4],
	'Psybient': [0.2, -0.6],
	'Psychedelic': [0.1, 0.2],
	'Psychedelic Rock': [0.1, 0.5],
	'Psytrance': [0.3, 0.85],
	'Punk': [-0.3, 0.8],
	'Punk Rock': [-0.2, 0.75],
	'R&B': [0.5, 0.2],
	'Rap': [0.2, 0.65],
	'Rave': [0.5, 0.9],
	'Reggae': [0.6, 0.3],
	'Retro': [0.4, 0.2],
	'Revival': [0.4, 0.3],
	'Rhythmic Soul': [0.5, 0.3],
	'Rock': [0.3, 0.6],
	'Rock & Roll': [0.5, 0.6],
	'Salsa': [0.7, 0.7],
	'Samba': [0.7, 0.6],
	'Satire': [0.4, 0.3],
	'Shoegaze': [-0.2, -0.2],
	'Showtunes': [0.6, 0.4],
	'Ska': [0.6, 0.6],
	'Slow Jam': [0.4, -0.5],
	'Slow Rock': [0.2, -0.4],
	'Sonata': [0.2, -0.3],
	'Soul': [0.5, 0.2],
	'Sound Clip': [0.0, -0.2],
	'Soundtrack': [0.1, 0.2],
	'Southern Rock': [0.4, 0.5],
	'Space': [0.0, -0.7],
	'Space Rock': [-0.1, 0.1],
	'Speech': [0.0, -0.5],
	'Swing': [0.6, 0.5],
	'Symphonic Rock': [0.3, 0.5],
	'Symphony': [0.2, 0.2],
	'Synth-Pop': [0.5, 0.4],
	'Tango': [0.4, 0.3],
	'Techno': [0.2, 0.8],
	'Techno-Industrial': [-0.3, 0.7],
	'Terror': [-0.8, 0.8],
	'Thrash Metal': [-0.6, 0.9],
	'Top 40': [0.6, 0.6],
	'Trailer': [0.1, 0.8],
	'Trance': [0.4, 0.85],
	'Tribal': [0.3, 0.6],
	'Trip-Hop': [-0.1, -0.4],
	'Trop Rock': [0.6, 0.4],
	'Vocal': [0.4, 0.0],
	'World Music': [0.4, 0.2],
	'Worldbeat': [0.5, 0.5],
}

export function computeGenreCollapse(
	rows: { label: string; count: number }[],
	topGenres: number,
): Map<string, string> {
	if (rows.length <= topGenres) return new Map()

	const groups = new Map<string, string>(rows.map((r) => [r.label, r.label]))

	const canonical = (g: string): string => {
		let c = groups.get(g) ?? g
		while (groups.get(c) !== c) c = groups.get(c)!
		return c
	}
	const distinctCanonicals = (): Set<string> => new Set(rows.map((r) => canonical(r.label)))

	while (distinctCanonicals().size > topGenres) {
		const arr = Array.from(distinctCanonicals())
		const canonicalCount = new Map<string, number>()
		for (const c of arr) canonicalCount.set(c, 0)
		for (const { label, count } of rows) {
			const c = canonical(label)
			canonicalCount.set(c, (canonicalCount.get(c) ?? 0) + count)
		}
		let mergeFrom = arr[0]
		for (const c of arr) {
			if ((canonicalCount.get(c) ?? 0) < (canonicalCount.get(mergeFrom) ?? 0)) mergeFrom = c
		}

		const coords = (g: string): [number, number] => GENRE_SIMILARITY[g] ?? [0, 0]
		let mergeTo = ''
		let minD = Infinity
		for (const c of arr) {
			if (c === mergeFrom) continue
			const [ax, ay] = coords(mergeFrom)
			const [bx, by] = coords(c)
			const d = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
			if (d < minD) {
				minD = d
				mergeTo = c
			}
		}
		groups.set(mergeFrom, mergeTo)
	}

	const result = new Map<string, string>()
	for (const { label } of rows) {
		const c = canonical(label)
		if (c !== label) result.set(label, c)
	}
	return result
}
