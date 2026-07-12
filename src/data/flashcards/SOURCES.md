# Flashcard content sources

Research notes for free Spanish phrase / short-sentence content (not single-word vocab). This app is Spanish-first, so sources below focus on **spa↔eng** pairs.

## Recommendation (what we used)

**Local Tatoeba-derived phrases** — best fit for this app.

| Item | Detail |
| --- | --- |
| Active deck | `phrases.json` — 300 short phrases/sentences |
| Expansion pool | `phrases-pool.json` — 2,500 ranked candidates |
| Rebuild | `python3 scripts/build-flashcards.py` |
| License | **CC BY 2.0 FR** (attribute Tatoeba) |
| Upstream TSV | [doozan/spanish_data `sentences.tsv`](https://github.com/doozan/spanish_data) (~161k eng–spa pairs with quality scores) |

Why local first: no API key, works offline, stable for a SPA, and we can filter for length / conversational mix. Tatoeba’s live search API is useful later (audio by id) but search has been flaky.

---

## Free sources evaluated

### 1. Tatoeba (best overall for phrases)

- Site: https://tatoeba.org/
- Downloads: https://tatoeba.org/en/downloads
- API: https://api.tatoeba.org/ (OpenAPI docs; v1 sentence fetch works)
- License: mostly **CC BY 2.0 FR**; some sentences **CC0**
- What you get: community sentence pairs, optional audio (`https://tatoeba.org/audio/download/{audioId}` when licensed)
- Bulk: `per_language/spa/spa_sentences.tsv.bz2`, full `sentences.tar.bz2`, `links.tar.bz2`, `sentences_with_audio.tar.bz2`
- API notes (checked Jul 2026):
  - `GET /v1/sentences/{id}?showtrans=all` — works
  - Search (`/unstable/sentences?...`) — currently failing (search engine down)
  - No API key required
- Caveat: lots of “Tom/Mary” example sentences; filter them out for a learner-facing deck

### 2. ManyThings Anki sentence packs (Tatoeba remix)

- https://www.manythings.org/anki/
- `spa-eng.zip` — ~144k tab-delimited pairs, ready for flashcard apps
- Same Tatoeba license / attribution expectations
- Convenient if you want a one-file download; hosting can be picky about bots

### 3. doozan/spanish_data (what the build script uses)

- https://github.com/doozan/spanish_data
- `sentences.tsv`: English / Spanish / attribution / quality scores / POS tags
- Built from Tatoeba + Wiktionary tooling; already quality-tagged (great for ranking)

### 4. OPUS parallel corpora

- https://opus.nlpl.eu/
- Huge free parallel data (OpenSubtitles, Europarl, etc.)
- Better for ML than flashcards: noisy, subtitle-ish, not curated for learners
- OPUS-API exists for discovering corpora, not ideal as a live card API

### 5. Other open decks / datasets

| Source | Notes |
| --- | --- |
| [Vuizur/tatoeba-to-anki](https://github.com/Vuizur/tatoeba-to-anki) | Ready Anki decks from Tatoeba + difficulty sorting + audio |
| [A7med205/nplus1-language-flashcards](https://github.com/A7med205/nplus1-language-flashcards) | Frequency / n+1 vocab with example sentences (more word-led) |
| [doozan/6001_Spanish](https://github.com/doozan/6001_Spanish) | Frequency vocab deck with usage sentences |
| [crmueller100/spanish-mochi-decks](https://github.com/crmueller100/spanish-mochi-decks) | Phrases/verbs; Tatoeba-attributed |

---

## API vs local for this project

| Approach | Pros | Cons |
| --- | --- | --- |
| **Local JSON (chosen)** | Offline, fast, curated, no CORS/key | Need rebuild script to refresh |
| **Tatoeba API at runtime** | Fresh data, audio ids | Search unreliable; CORS may need proxy; rate/availability risk |
| **ManyThings / OPUS at runtime** | Large corpora | Not learner-curated; download size / noise |

**Suggested next step for audio:** keep cards local; optionally fetch Tatoeba audio by `tatoeba_ids` when `include=audios` returns a reusable license, or generate TTS.

---

## Card shape

```json
{
  "id": "spa-0001",
  "es": "¿Qué hay en el menú?",
  "en": "What's on the menu?",
  "bucket": "question",
  "features": ["present"],
  "min_level": 1,
  "tatoeba_ids": [123, 456],
  "source": "tatoeba"
}
```

Buckets: `statement` · `question` · `greeting_polite` · `exclamation`

### Grammar tags (`features` / `min_level`)

Built by `scripts/build-flashcards.py` using:
1. FreeLing verb spans from doozan `sentences.tsv` (which tokens are verbs)
2. Reverse conjugations from [verbecc](https://github.com/bretttolbert/verbecc) for the top ~450 verbs
3. Compound detectors for *ir a* + infinitive, *haber* + participle, *estar* + gerund

| `min_level` | Unlocks (cumulative) |
| --- | --- |
| 1 | present, ir_a_future, imperative, progressive |
| 2 | + preterite, present_perfect |
| 3 | + imperfect, future |
| 4 | + conditional, present_subjunctive |
| 5 | + imperfect_subjunctive, pluperfect, conditional_perfect |

Filter in the app with `card.min_level <= userLevel` (see `getFlashcardsForLevel`).

Rebuild: `npm run build:flashcards` (uses `.venv-flashcards`).
