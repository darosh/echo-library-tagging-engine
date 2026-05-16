# echo-library-tagging-engine

- This is set of CLI utils I use for the [Echo Mini](https://www.fiio.com/echomini) on Mac
- I originally wanted to use genre for auto-detected mood like channel play similar to [SensMe](https://en.wikipedia.org/wiki/SensMe) in old Sony players, then I realized the Echo mini is very picky around tags and format of the files, so I focused on that instead
- It is experimental / unstable, and you will be likely much happier with [silent-sphinx/snowsky-echo-mini-toolbox](https://github.com/silent-sphinx/snowsky-echo-mini-toolbox)
- Backup your files

## Setup

```bash
brew install deno
brew install --cask kid3
brew install ffmpeg
brew install flac
brew install exiftool
brew install rsgain
brew install --cask db-browser-for-sqlite
brew install imagemagick
brew install python
```

```bash
git clone https://github.com/jan/echo-library-tagging-engine.git
cd echo-library-tagging-engine
```

## Usage

### Print help

```bash
deno run -A elite.ts
```

```
Usage:   elite
Version: 0.1.0

Description:

  Echo library tagging engine

Options:

  -h, --help     - Show this help.                            
  -V, --version  - Show the version number for this program.  

Commands:

  db-collect        - Scan library and extract metadata via kid3 → SQLite                 
  db-analyze        - Run essentia mood/genre inference on collected files → SQLite       
  db-collect-lufs   - Scan album LUFS/peak/gain via rsgain → SQLite                       
  db-stats          - Show mood tag distribution from analysis results                    
  db-write          - Write Genre tag to audio files from analysis results                
  db-consolidate    - Write consolidated genre tags to audio files                        
  from-dsf-to-flac  - Convert DSF files to FLAC at 24-bit/96kHz                           
  from-wav-to-flac  - Convert WAV files to FLAC at 24-bit/96kHz                           
  from-flac-to-mp3  - Convert FLAC and DSF files to MP3 (VBR V0)                          
  from-mp4-to-mp3   - Extract audio from MP4/M4A files to MP3                             
  from-m4a-to-mp3   - Convert M4A files to MP3 (preserving bitrate)                       
  from-wma-to-mp3   - Convert WMA files to MP3                                            
  flac-check        - Validate FLAC files for blocksize, sample rate, and bit depth limits
  flac-fix          - Re-encode non-compliant FLAC files in-place with blocksize 4096     
  tag-verify        - Verify audio file tags directly from files (no database)            
  tag-resize-art    - Resize embedded album art larger than 500x500 pixels using kid3     
  tag-janitor       - Strip ID3v1 and non-standard tags from audio files via kid3         
  sd-count          - Count audio files per top-level folder                              
  sd-copy           - Copy audio files to destination in sorted order (no Mac artifacts)  
  sd-demac          - Clean Mac artifacts from an SD card         
```

### Count your files

```bash
MY_LIB=/Volumes/ALl/MUSIC
```

```bash
deno run -A elite.ts sd-count --input $MY_LIB
```

```
Folder                                                 MP3   FLAC    DSF    WAV    APE    OGG    M4A    WMA
────────────────────────────────────────────────────────────────────────────────────────────────────────────
_ARCHIVE                                              3064      0      0      0      0      0      0      0
_ARCHIVE_320                                           363      0      0      0      0      0      0      0
_ARCHIVE_320_FAVORITE                                  461      0      0      0      0      0      0      0
_ARCHIVE_FAVORITE                                     2299      0      0      0      0      0      0      0
_ARCHIVE_FAVORITE_TOP                                  358      0      0      0      0      0      0      0
_BINAURAL                                               12      0      0      0      0      0      0      0
_BINAURAL_FLAC                                           0     50      0      0      0      0      0      0
_BOOKS                                                 249      0      0      0      0      0      0      0
_BOOKS_FAVORITE                                         12      0      0      0      0      0      0      0
_CLASSICAL                                             783      0      0      0      0      0      0      0
_COLLECTIONS                                           199      0      0      0      0      0      0      0
_COLLECTIONS_FAVORITE                                 1384      0      0      0      0      0      0      0
_COLLECTIONS_FLAC                                        0      8      0      0      0      0      0      0
_CZ                                                   1109      0      0      0      0      0      0      0
_CZ_FAVORITE                                           545      0      0      0      0      0      0      0
_DSD                                                     0      0    210      0      0      0      0      0
_DSD_NATIVE                                              0      0    173      0      0      0      0      0
_DSD_NATIVE_SANITIZED                                    0      0    173      0      0      0      0      0
_DSD_SANITIZED                                           0      0    210      0      0      0      0      0
_FLAC                                                    0    713      0      0      0      0      0      0
_FLAC_30                                                 0    487      0      0      0      0      0      0
_FLAC_HR                                                 0    243      0      0      0      0      0      0
_GUITAR                                                459      0      0      0      0      0      0      0
_GUITAR_FAVORITE                                       224      0      0      0      0      0      0      0
_HUMBLE_GAME                                           209      0      0      0      0      0      0      0
_HUMBLE_GAME_FAVORITE                                   12      0      0      0      0      0      0      0
_HUMBLE_MUSIC                                          106      0      0      0      0      0      0      0
_JAZZ                                                  287      0      0      0      0      0      0      0
_JAZZ_FAVORITE                                         292      0      0      0      0      0      0      0
_OSC_MUSIC                                               0     51      0      0      0      0      0      0
_OST                                                   577      0      0      0      0      0      0      0
_OST_320                                                69      0      0      0      0      0      0      0
_OST_320_FAVORITE                                       81      0      0      0      0      0      0      0
_OST_FAVORITE                                          149      0      0      0      0      0      0      0
_RELAX                                                  23      0      0      0      0      0      0      0
_SK                                                    260      0      0      0      0      0      0      0
_SK_FAVORITE                                           100      0      0      0      0      0      0      0
_TEST                                                   19      0      0      0      0      0      0      0
_WORK                                                   22      6      0      4      0      0      0      0
_WORLD                                                  66      0      0      0      0      0      0      0
_WORLD_FAVORITE                                        100      0      0      0      0      0      0      0
_YT                                                     17      0      0      0      0      0      1      0
────────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL                                                13910   1558    766      4      0      0      1      0  (16239 selected)

Other file types: ds_store, jpg, mp4, pdf, png, txt

```

### Filter and count files

```bash
MY_FILTER="{*_FAVORITE,*_FAVORITE_TOP,_FLAC,_FLAC_30,_FLAC_HR,_DSD_SANITIZED,_DSD_NATIVE_SANITIZED,_RELAX,_WORK,_HUMBLE_MUSIC,_YT,_TEST,_BINAURAL_FLAC}/**/*.{mp3,dsf,flac}"
```

```bash
deno run -A elite.ts sd-count --input $MY_LIB --filter $MY_FILTER
```

```
Folder                                                 MP3   FLAC    DSF    WAV    APE    OGG    M4A    WMA
────────────────────────────────────────────────────────────────────────────────────────────────────────────
_ARCHIVE_320_FAVORITE                                  461      0      0      0      0      0      0      0
_ARCHIVE_FAVORITE                                     2299      0      0      0      0      0      0      0
_ARCHIVE_FAVORITE_TOP                                  358      0      0      0      0      0      0      0
_BINAURAL_FLAC                                           0     50      0      0      0      0      0      0
_BOOKS_FAVORITE                                         12      0      0      0      0      0      0      0
_COLLECTIONS_FAVORITE                                 1384      0      0      0      0      0      0      0
_CZ_FAVORITE                                           545      0      0      0      0      0      0      0
_DSD_NATIVE_SANITIZED                                    0      0    173      0      0      0      0      0
_DSD_SANITIZED                                           0      0    210      0      0      0      0      0
_FLAC                                                    0    713      0      0      0      0      0      0
_FLAC_30                                                 0    487      0      0      0      0      0      0
_FLAC_HR                                                 0    243      0      0      0      0      0      0
_GUITAR_FAVORITE                                       224      0      0      0      0      0      0      0
_HUMBLE_GAME_FAVORITE                                   12      0      0      0      0      0      0      0
_HUMBLE_MUSIC                                          106      0      0      0      0      0      0      0
_JAZZ_FAVORITE                                         292      0      0      0      0      0      0      0
_OST_320_FAVORITE                                       81      0      0      0      0      0      0      0
_OST_FAVORITE                                          149      0      0      0      0      0      0      0
_RELAX                                                  23      0      0      0      0      0      0      0
_SK_FAVORITE                                           100      0      0      0      0      0      0      0
_TEST                                                   19      0      0      0      0      0      0      0
_WORK                                                   22      6      0      0      0      0      0      0
_WORLD_FAVORITE                                        100      0      0      0      0      0      0      0
_YT                                                     17      0      0      0      0      0      0      0
────────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL                                                 6204   1499    383      0      0      0      0      0  (8086 selected)
ALL                                                  13910   1558    766      4      0      0      1      0
```

### Copy filtered files to SD card

```bash
MY_SD_LIB=/Volumes/MINI/MUSIC
```

```bash
deno run -A elite.ts sd-copy --input $MY_LIB --output $MY_SD_LIB --filter $MY_FILTER
```

```
▶ Copying from /Volumes/ALl/MUSIC to /Volumes/SD/MUSIC (filter: {*_FAVORITE,*_FAVORITE_TOP,_FLAC,_FLAC_30,_FLAC_HR,_DSD_SANITIZED,_DSD_NATIVE_SANITIZED,_RELAX,_WORK,_HUMBLE_MUSIC,_YT,_TEST,_BINAURAL_FLAC}/**/*.{mp3,dsf,flac})
  [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 141/8086 00:00:03 ETA 00:03:23 Processing 01 - Song,mp3
```

### Copy filtered files to SD card without track numbers and special characters

"All songs" shows file names, so you might prefer to use the files w/o tracks numbers

```bash
deno run -A elite.ts sd-copy --input $MY_LIB --output $MY_SD_LIB --filter $MY_FILTER --strip-track --ascii
```

```
▶ Copying from /Volumes/ALl/MUSIC to /Volumes/SD/MUSIC (filter: {*_FAVORITE,*_FAVORITE_TOP,_FLAC,_FLAC_30,_FLAC_HR,_DSD_SANITIZED,_DSD_NATIVE_SANITIZED,_RELAX,_WORK,_HUMBLE_MUSIC,_YT,_TEST,_BINAURAL_FLAC}/**/*.{mp3,dsf,flac})
  [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 141/8086 00:00:03 ETA 00:03:23 Processing Song,mp3
```

### Clean Mac artifacts from an SD card

```bash
MY_SD_ROOT=/Volumes/MINI
```

```bash
sudo deno run -A elite.ts sd-demac --input $MY_SD_ROOT
```

```
▶ Cleaning SD card: /Volumes/MINI
Checking for Mac artifacts...
  441 artifact(s) found
Deleting artifacts...
  Done (2 could not be deleted — may need sudo)
Checking for zero-size files...
  2 zero-size file(s) found
    /Volumes/MINI/.metadata_never_index
    /Volumes/MINI/.Trashes
Deleting zero-size files...
  Done (1 could not be deleted)
Checking for empty folders...
  0 empty folders found
Locking SD card against future Mac artifacts...
  .metadata_never_index created

  ✓ /Volumes/MINI is clean.
```

### Check album art

```bash
deno run -A elite.ts tag-resize-art --input $MY_LIB --dry-run
```

```
▶ Scanning art dimensions in /Volumes/ALl/MUSIC
  · Found 16234 files
 [███████░░░░░░░░░░░░░░░░░░░░░░░] 3784/16234 00:00:58 ETA 00:03:13 Scanning 03 - Ride.mp3    
  ✗ _ARCHIVE_320_FAVORITE/Twenty One Pilots/Blurryface/01 - Heavydirtysoul.mp3
    art is progressive JPEG
```

### Check and fix album art

```bash
deno run -A elite.ts tag-resize-art --input $MY_LIB
```

### Scan and analyze to db

```bash
MY_LIB=/Volumes/ALl/MUSIC
MY_PLAYLISTS=/Volumes/ALl/MUSIC/_MOODS
MY_DB=db/all.db
deno run -A elite.ts db-collect --input $MY_LIB --db $MY_DB
deno run -A elite.ts db-analyze --input $MY_LIB --db $MY_DB --max 6
```

### Make mood playlists

```bash
deno run -A elite.ts db-mood-playlists --input $MY_LIB --db $MY_DB --output $MY_PLAYLISTS --max 15
```

```
mood        tracks
----------  ------
energetic     3512
love          2403
film          2010
melodic       1723
relaxing      1248
happy         1104
dark           665
christmas      597
deep           566
meditative     533
epic           443
heavy          404
space          308
ballad         223
soundscape     153

Wrote 15 playlists to /Volumes/ALl/MUSIC/_MOODS
```
