# Apex Voice

A script reader for the Apex suite. Type or paste text, choose one of the voices the device already
has, set speed, pitch and volume, and hear it read back. Nothing is uploaded, no key is needed, and
the whole app is one static folder with relative (`./`) paths for `/apps/voice/`.

**It cannot export an audio file.** The Web Speech API speaks a string; it never hands the audio back
to the page, so there is no blob to save and no `MediaRecorder` route into it. That is a browser
limit, not a missing feature. Narration plays live, and the script can be saved and reloaded here. For
a shareable file you need a server-side text-to-speech service.

```
index.html      script pane, voice and prosody controls, saved scripts
styles.css      dark two-column layout, collapses to one column under 820px
app.js          voice list, SpeechSynthesis narration, progress, localStorage
manifest.json   relative start_url and scope, standalone display
sw.js           offline shell, scoped to this folder
icons/          192, 512 and maskable 512
```

## What it does

- **Voice list** from `speechSynthesis.getVoices()`, grouped by language and refreshed on
  `voiceschanged`, because several browsers return an empty list on the first call. With no installed
  voices the app says so instead of failing silently.
- **Speak / Pause / Resume / Stop**, with `Restart` while something is playing. Escape stops,
  Ctrl/Cmd+Enter speaks, and the narration is cancelled when the page goes away so a tab never keeps
  talking.
- **Speed** 0.5×–2×, **pitch** 0–2, **volume** 0–100%, applied to the next utterance (changing a
  slider mid-sentence does not restart it — press Speak again).
- **Progress** from the utterance's `boundary` events, so the bar tracks the text actually being
  spoken. Browsers that do not emit boundaries simply leave the bar at zero while the status line
  shows the voice speaking.
- **Counts and estimate**: characters, words, and an approximate duration from 165 words per minute
  adjusted by the chosen speed.
- **Saved scripts** in `localStorage` under `apex.voice.v1`: name, text, voice and prosody are stored
  together. Loading one restores all of it; saving under an existing name updates that entry. Capped
  at 40.
- Cross-link to Apex Video (`../video/`) for the pictures half of a narrated clip.

## Storage

```json
{
  "settings": { "voiceURI": "…", "rate": 1, "pitch": 1, "volume": 1 },
  "snippets": [
    { "id": "…", "name": "Product intro", "text": "…", "voiceURI": "…",
      "rate": 1, "pitch": 1, "volume": 1, "createdAt": 1763472000000 }
  ]
}
```

## Offline

The shell is precached by `sw.js` (`apex-voice-v1`), so the app opens with no connection. Installed
system voices are local, so narration works offline too — with the caveat that some platforms hand
`speechSynthesis` to a cloud voice, which then needs a network. Bump `CACHE` when shell files change.

## Running it

```bash
python3 -m http.server 8080
# then open http://127.0.0.1:8080/
```

## Bundling into ApexOS

Roster entry `Apex-Voice voice`, catalogue entry `{ id: 'voice', name: 'Apex Voice', cat: 'Media',
repo: 'Apex-Voice', path: '/apps/voice/' }`. The "Open Apex Video" link is `../video/`, which
resolves to `/apps/video/` in the bundle.

## State of this repo

Not yet exercised in a browser. Unverified: the voice list on a machine with real voices, boundary
progress, pause/resume across browsers, and the empty-voice fallback.
