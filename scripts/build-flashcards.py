#!/usr/bin/env python3
"""Build grammar-tagged Spanish phrase flashcards from Tatoeba (via doozan/spanish_data).

Tags each card with tense/mood features and a Pimsleur-oriented min_level (1–5).

Usage:
  .venv-flashcards/bin/python scripts/build-flashcards.py
  .venv-flashcards/bin/python scripts/build-flashcards.py --input /tmp/doozan-sentences.tsv

Requires the local venv with verbecc installed (see scripts/README-flashcards.md).
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src" / "data" / "flashcards"
CACHE_DIR = ROOT / "scripts" / ".cache"
SOURCE_URL = (
    "https://raw.githubusercontent.com/doozan/spanish_data/master/sentences.tsv"
)
FREQUENCY_URL = (
    "https://raw.githubusercontent.com/doozan/spanish_data/master/frequency.csv"
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("flashcards")

NAME_RE = re.compile(
    r"\b(Tom|Mary|John|Maria|José|Jose|Alice|Bob|Lucy|Jim|Mike|Bill)\b", re.I
)
BLOCK_RE = re.compile(
    r"\b(suicid|kill|murder|rape|nazi|porn|sexo|drogas?|cocaine|heroin|"
    r"bastard|bitch|shit|fuck|damn|hell|diablo|matar|muerte|muerto|"
    r"gun|arma|sangre|blood)\b",
    re.I,
)
USEFUL_RE = re.compile(
    r"\b(cómo|donde|dónde|cuando|cuándo|qué|quien|quién|por qué|porque|"
    r"puedo|puede|quiero|necesito|tengo|hay|está|estoy|soy|vamos|"
    r"gracias|por favor|perdón|disculpe|hola|buenos|buenas|adiós|adios|"
    r"mucho|poco|aquí|allí|ahora|después|antes|hoy|mañana|"
    r"comer|beber|ir|venir|hablar|saber|entender|ayudar|"
    r"cuesta|precio|agua|comida|casa|trabajo|amigo|familia|"
    r"me gusta|te gusta|no sé|lo siento|de nada|está bien|"
    r"dónde está|cuánto cuesta|me llamo|encantado|con permiso)\b",
    re.I,
)
TOKEN_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:'[A-Za-z]+)?")
CLITIC_RE = re.compile(
    r"(?:me|te|se|nos|os|lo|la|le|los|las|les|melo|mela|telo|tela|"
    r"selo|sela|noslo|nosla)$",
    re.I,
)

# Pimsleur-oriented unlock levels for grammar features
FEATURE_LEVEL: dict[str, int] = {
    "present": 1,
    "ir_a_future": 1,
    "imperative": 1,
    "progressive": 1,
    "infinitive": 1,
    "gerund": 1,
    "preterite": 2,
    "present_perfect": 2,
    "imperfect": 3,
    "future": 3,
    "conditional": 4,
    "present_subjunctive": 4,
    "imperfect_subjunctive": 5,
    "pluperfect": 5,
    "future_perfect": 5,
    "conditional_perfect": 5,
    "unknown_finite": 5,
}

LEVEL1_TAGS = {"present", "ir_a_future", "imperative", "progressive", "infinitive", "gerund"}

# verbecc mood/tense → our feature tags
MOOD_TENSE_TO_FEATURE: dict[tuple[str, str], str] = {
    ("indicativo", "presente"): "present",
    ("indicativo", "pretérito-perfecto-simple"): "preterite",
    ("indicativo", "pretérito-imperfecto"): "imperfect",
    ("indicativo", "futuro"): "future",
    ("indicativo", "pretérito-perfecto-compuesto"): "present_perfect",
    ("indicativo", "pretérito-pluscuamperfecto"): "pluperfect",
    ("indicativo", "futuro-perfecto"): "future_perfect",
    ("subjuntivo", "presente"): "present_subjunctive",
    ("subjuntivo", "pretérito-imperfecto"): "imperfect_subjunctive",
    ("subjuntivo", "pretérito-imperfecto-1"): "imperfect_subjunctive",
    ("subjuntivo", "pretérito-imperfecto-2"): "imperfect_subjunctive",
    ("subjuntivo", "pretérito-perfecto"): "present_perfect",
    ("subjuntivo", "pretérito-pluscuamperfecto-1"): "pluperfect",
    ("subjuntivo", "pretérito-pluscuamperfecto-2"): "pluperfect",
    ("condicional", "presente"): "conditional",
    ("condicional", "perfecto"): "conditional_perfect",
    ("imperativo", "afirmativo"): "imperative",
    ("imperativo", "negativo"): "imperative",
    ("infinitivo", "infinitivo"): "infinitive",
    ("gerundio", "gerundio"): "gerund",
    ("participo", "participo"): "participle",
}

HABER_PRESENT = {
    "he",
    "has",
    "ha",
    "hemos",
    "habéis",
    "habeis",
    "han",
}
HABER_IMPERFECT = {"había", "habias", "habías", "habiamos", "habíamos", "habían", "habian"}
HABER_CONDITIONAL = {
    "habría",
    "habria",
    "habrías",
    "habrias",
    "habríamos",
    "habriamos",
    "habrían",
    "habrian",
}
IR_PRESENT = {"voy", "vas", "va", "vamos", "vais", "van"}
ESTAR_PRESENT = {"estoy", "estás", "estas", "está", "esta", "estamos", "estáis", "estais", "están", "estan"}

PRONOUNS = {
    "yo",
    "tú",
    "tu",
    "vos",
    "él",
    "el",
    "ella",
    "usted",
    "nosotros",
    "nosotras",
    "vosotros",
    "vosotras",
    "ellos",
    "ellas",
    "ustedes",
}


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text))


def bucket(spa: str) -> str:
    if "¿" in spa or spa.strip().endswith("?"):
        return "question"
    if re.search(
        r"^(hola|buenos|buenas|adiós|gracias|perdón|disculpe|por favor|de nada|lo siento|con permiso)",
        spa,
        re.I,
    ):
        return "greeting_polite"
    if spa.strip().endswith("!") or spa.startswith("¡"):
        return "exclamation"
    return "statement"


def score_row(eng: str, spa: str, eng_q: int, spa_q: int) -> int:
    score = (eng_q + spa_q) * 10
    words = word_count(spa)
    if 3 <= words <= 7:
        score += 8
    elif 2 <= words <= 9:
        score += 4
    if USEFUL_RE.search(spa):
        score += 12
    return score


def strip_accents(text: str) -> str:
    table = str.maketrans("áéíóúüñÁÉÍÓÚÜÑ", "aeiouunAEIOUUN")
    return text.translate(table)


def normalize_form(text: str) -> str:
    return strip_accents(text.lower())


def tokenize(spa: str) -> list[str]:
    return TOKEN_RE.findall(spa)


def strip_clitics(token: str) -> list[str]:
    """Return [base] or [base, full] candidates after removing object clitics."""
    low = token.lower()
    variants = [low]
    # attached clitics on imperatives / infinitives / gerunds: dímelo, hacerlo, pensándolo
    if len(low) >= 4:
        for suffix in (
            "melo",
            "mela",
            "melos",
            "melas",
            "telo",
            "tela",
            "selo",
            "sela",
            "noslo",
            "nosla",
            "me",
            "te",
            "se",
            "nos",
            "os",
            "lo",
            "la",
            "le",
            "los",
            "las",
            "les",
        ):
            if low.endswith(suffix) and len(low) - len(suffix) >= 2:
                base = low[: -len(suffix)]
                # restore imperative accent often dropped in text: dime <- di+me
                variants.append(base)
                if base.endswith("ar") or base.endswith("er") or base.endswith("ir"):
                    variants.append(base)  # infinitive+clitic
                break
    return list(dict.fromkeys(variants))


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    log.info("Downloading %s", url)
    urllib.request.urlretrieve(url, dest)
    return dest


def load_top_verbs(frequency_path: Path, limit: int = 500) -> list[str]:
    verbs: list[str] = []
    with frequency_path.open(encoding="utf-8") as handle:
        next(handle, None)
        for line in handle:
            parts = line.rstrip("\n").split(",")
            if len(parts) < 3:
                continue
            lemma, pos = parts[1], parts[2]
            if pos != "v":
                continue
            if lemma in {"matar"}:  # skip blocked lemma seed
                continue
            verbs.append(lemma)
            if len(verbs) >= limit:
                break
    # Ensure core irregulars are present
    for core in (
        "ser",
        "estar",
        "haber",
        "tener",
        "ir",
        "hacer",
        "poder",
        "decir",
        "querer",
        "ver",
        "saber",
        "dar",
        "venir",
        "poner",
        "salir",
        "llegar",
        "hablar",
        "comer",
        "vivir",
        "gustar",
        "necesitar",
        "llamar",
        "pensar",
        "encontrar",
        "conocer",
        "parecer",
        "deber",
        "dejar",
        "llevar",
        "seguir",
        "volver",
        "pasar",
        "entrar",
        "abrir",
        "cerrar",
        "oír",
        "oir",
        "reír",
        "reir",
    ):
        if core not in verbs:
            verbs.append(core)
    return verbs


def extract_verb_token(conjugated: str, pronoun: str | None) -> str | None:
    text = conjugated.strip()
    if not text:
        return None
    # Drop leading pronoun if present
    parts = text.split()
    if pronoun and parts and normalize_form(parts[0]) == normalize_form(pronoun):
        parts = parts[1:]
    elif parts and normalize_form(parts[0]) in PRONOUNS:
        parts = parts[1:]
    if not parts:
        return None
    # For compounds like "he hablado" / "voy a hablar" keep full phrase too
    return " ".join(parts).lower()


def build_form_index(verbs: list[str], cache_path: Path) -> dict[str, set[str]]:
    if cache_path.exists():
        log.info("Loading conjugation cache %s", cache_path)
        raw = json.loads(cache_path.read_text(encoding="utf-8"))
        return {k: set(v) for k, v in raw.items()}

    from verbecc import CompleteConjugator

    log.info("Building conjugation reverse index for %d verbs…", len(verbs))
    conjugator = CompleteConjugator(lang="es")
    index: dict[str, set[str]] = defaultdict(set)

    def add(form: str, feature: str) -> None:
        if not form:
            return
        # Bare participles must not inherit compound-tense labels
        if feature in {
            "present_perfect",
            "pluperfect",
            "future_perfect",
            "conditional_perfect",
        }:
            # Only index the full multi-word string for compounds
            if " " not in form.strip():
                index[normalize_form(form)].add("participle")
                index[form.lower()].add("participle")
                return
        if feature == "participle":
            index[normalize_form(form)].add("participle")
            index[form.lower()].add("participle")
            return
        index[form.lower()].add(feature)
        stripped = normalize_form(form)
        # Only add accent-stripped keys when the form has no accents,
        # so habló does not pollute hablo.
        if stripped == form.lower():
            index[stripped].add(feature)

    for i, verb in enumerate(verbs, 1):
        try:
            result = conjugator.conjugate(verb)
        except Exception as exc:  # noqa: BLE001
            log.debug("skip %s: %s", verb, exc)
            continue
        for mood in result:
            mood_name = str(getattr(mood, "value", mood))
            tense_map = result[mood]
            for tense in tense_map:
                tense_name = str(getattr(tense, "value", tense))
                feature = MOOD_TENSE_TO_FEATURE.get((mood_name, tense_name))
                if not feature:
                    continue
                for entry in tense_map[tense]:
                    conjugations = []
                    if hasattr(entry, "get_conjugations"):
                        conjugations = entry.get_conjugations() or []
                    elif getattr(entry, "conjugations", None):
                        conjugations = entry.conjugations
                    pronoun = ""
                    if hasattr(entry, "get_pronoun"):
                        pronoun_obj = entry.get_pronoun()
                        pronoun = str(getattr(pronoun_obj, "value", pronoun_obj) or "")
                    for conj in conjugations:
                        token = extract_verb_token(conj, pronoun or None)
                        if not token:
                            continue
                        add(token, feature)
                        bits = token.split()
                        if len(bits) > 1:
                            # Final word of a compound is a participle, not a perfect tense
                            add(bits[-1], "participle")
        if i % 50 == 0:
            log.info("  conjugated %d/%d", i, len(verbs))

    # Manual high-value forms
    extras = {
        "hay": {"present"},
        "haya": {"present_subjunctive"},
        "hayáis": {"present_subjunctive"},
        "hayan": {"present_subjunctive"},
        "es": {"present"},
        "son": {"present"},
        "soy": {"present"},
        "eres": {"present"},
        "somos": {"present"},
        "sois": {"present"},
        "está": {"present"},
        "estan": {"present"},
        "están": {"present"},
        "estoy": {"present"},
        "fui": {"preterite"},
        "fue": {"preterite"},
        "fuiste": {"preterite"},
        "fuimos": {"preterite"},
        "fueron": {"preterite"},
        "era": {"imperfect"},
        "eras": {"imperfect"},
        "éramos": {"imperfect"},
        "eramos": {"imperfect"},
        "eran": {"imperfect"},
        "iba": {"imperfect"},
        "ibas": {"imperfect"},
        "íbamos": {"imperfect"},
        "ibamos": {"imperfect"},
        "iban": {"imperfect"},
    }
    for form, feats in extras.items():
        for feat in feats:
            add(form, feat)
    # "se" is usually a pronoun; drop accidental verb tags on bare se
    index.pop("se", None)

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps({k: sorted(v) for k, v in sorted(index.items())}, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info("Cached %d surface forms → %s", len(index), cache_path)
    return index


def disambiguate_token_features(feats: set[str]) -> set[str]:
    """If a form can be L1 or advanced, prefer the easiest reading for that token."""
    if not feats:
        return feats
    # Drop participle-only noise unless it's the only tag
    meaningful = {f for f in feats if f != "participle"}
    if not meaningful:
        return feats
    if meaningful & LEVEL1_TAGS:
        # Keep only the easiest band for this token
        min_level = min(FEATURE_LEVEL.get(f, 5) for f in meaningful)
        return {f for f in meaningful if FEATURE_LEVEL.get(f, 5) == min_level}
    return meaningful


def parse_freeling_verbs(tag_field: str) -> list[str]:
    """Extract surface verb forms from doozan FreeLing tag column."""
    if not tag_field:
        return []
    verbs: list[str] = []
    for chunk in tag_field.split():
        if not chunk.startswith(":v,"):
            continue
        payload = chunk[3:]
        for piece in payload.split(","):
            form = piece.split("|", 1)[0].strip() if piece else ""
            if form:
                verbs.append(form)
    return verbs


def tag_sentence(
    spa: str,
    form_index: dict[str, set[str]],
    freeling_verbs: list[str] | None = None,
) -> tuple[list[str], int]:
    tokens = tokenize(spa)
    norms = [normalize_form(t) for t in tokens]
    features: set[str] = set()

    # Compound constructions over the full sentence
    i = 0
    while i < len(norms):
        tok = norms[i]
        if tok in IR_PRESENT and i + 2 < len(norms) and norms[i + 1] == "a":
            nxt = norms[i + 2]
            nxt_feats = form_index.get(nxt, set()) | form_index.get(tokens[i + 2].lower(), set())
            if "infinitive" in nxt_feats or nxt.endswith(("ar", "er", "ir")):
                features.add("ir_a_future")
                i += 3
                continue
        if tok in HABER_PRESENT and i + 1 < len(norms):
            part = norms[i + 1]
            part_feats = form_index.get(part, set()) | form_index.get(tokens[i + 1].lower(), set())
            if "participle" in part_feats or part.endswith(("ado", "ido", "to", "so", "cho")):
                features.add("present_perfect")
                i += 2
                continue
        if tok in HABER_IMPERFECT and i + 1 < len(norms):
            part = norms[i + 1]
            part_feats = form_index.get(part, set()) | form_index.get(tokens[i + 1].lower(), set())
            if "participle" in part_feats or part.endswith(("ado", "ido", "to", "so", "cho")):
                features.add("pluperfect")
                i += 2
                continue
        if tok in HABER_CONDITIONAL and i + 1 < len(norms):
            part = norms[i + 1]
            part_feats = form_index.get(part, set()) | form_index.get(tokens[i + 1].lower(), set())
            if "participle" in part_feats or part.endswith(("ado", "ido", "to", "so", "cho")):
                features.add("conditional_perfect")
                i += 2
                continue
        if tok in ESTAR_PRESENT and i + 1 < len(norms):
            ger = norms[i + 1]
            ger_feats = form_index.get(ger, set()) | form_index.get(tokens[i + 1].lower(), set())
            if "gerund" in ger_feats or ger.endswith(("ando", "iendo", "yendo")):
                features.add("progressive")
                features.add("present")
                i += 2
                continue
        i += 1

    # Only look up FreeLing-identified verbs (avoids casa→casar false positives)
    verb_forms = freeling_verbs if freeling_verbs is not None else tokens
    for form in verb_forms:
        raw = form.lower()
        exact_feats: set[str] = set()
        for cand in (raw, *[v.lower() for v in strip_clitics(form)]):
            exact_feats |= form_index.get(cand, set())
        if exact_feats:
            token_feats = exact_feats
        else:
            token_feats = set()
            for cand in (raw, normalize_form(form), *[normalize_form(v) for v in strip_clitics(form)]):
                token_feats |= form_index.get(cand, set())
        features |= disambiguate_token_features(token_feats)

    features.discard("participle")
    features.discard("infinitive")
    features.discard("gerund")

    if not features:
        # Only guess from known verb tokens that missed the lexicon
        miss_forms = [normalize_form(v) for v in verb_forms] or norms
        joined = " ".join(miss_forms)
        if re.search(
            r"\b\w{3,}(é|ó|aste|asteis|aron|ió|ieron|imos|iste|isteis)\b",
            joined,
        ):
            features.add("preterite")
        elif re.search(r"\b\w{3,}(aba|abas|aban|ía|ías|ían)\b", joined):
            features.add("imperfect")
        elif re.search(r"\b\w{4,}(aré|arás|ará|aremos|arán|eré|erá|iré|irá)\b", joined):
            features.add("future")
        elif re.search(r"\b\w{4,}(ría|rías|ríamos|rían)\b", joined):
            features.add("conditional")
        else:
            features.add("present")

    levels = [FEATURE_LEVEL.get(f, 5) for f in features]
    min_level = max(levels) if levels else 1
    return sorted(features), min_level


def load_rows(path: Path) -> list[tuple[str, str, str, int, int, str]]:
    rows: list[tuple[str, str, str, int, int, str]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            eng, spa, attr = parts[0], parts[1], parts[2]
            eng_q = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
            spa_q = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0
            tags = parts[5] if len(parts) > 5 else ""
            rows.append((eng, spa, attr, eng_q, spa_q, tags))
    return rows


def clean(card: dict, index: int, prefix: str) -> dict:
    return {
        "id": f"{prefix}-{index:04d}",
        "es": card["es"],
        "en": card["en"],
        "bucket": card["bucket"],
        "features": card["features"],
        "min_level": card["min_level"],
        "tatoeba_ids": card["tatoeba_ids"],
        "source": card["source"],
    }


def build(
    rows: list[tuple[str, str, str, int, int, str]],
    form_index: dict[str, set[str]],
    deck_per_level: int = 250,
    pool_size: int = 10000,
) -> tuple[list[dict], list[dict]]:
    candidates: list[dict] = []
    seen: set[str] = set()

    for eng, spa, attr, eng_q, spa_q, tags in rows:
        words = word_count(spa)
        if words < 2 or words > 12:
            continue
        if len(spa) > 100 or len(eng) > 110:
            continue
        if eng.isupper() and len(eng) <= 8:
            continue
        if NAME_RE.search(spa) or NAME_RE.search(eng):
            continue
        if BLOCK_RE.search(spa) or BLOCK_RE.search(eng):
            continue
        key = spa.lower().strip()
        if key in seen:
            continue
        seen.add(key)
        score = score_row(eng, spa, eng_q, spa_q)
        if score < 12:
            continue
        freeling_verbs = parse_freeling_verbs(tags)
        features, min_level = tag_sentence(spa, form_index, freeling_verbs)
        ids = [int(x) for x in re.findall(r"#(\d+)", attr)[:2]]
        candidates.append(
            {
                "en": eng,
                "es": spa,
                "score": score,
                "bucket": bucket(spa),
                "features": features,
                "min_level": min_level,
                "tatoeba_ids": ids,
                "source": "tatoeba",
            }
        )

    candidates.sort(key=lambda c: (-c["score"], word_count(c["es"]), len(c["es"])))
    log.info("Tagged candidates: %d", len(candidates))
    log.info(
        "By min_level: %s",
        dict(Counter(c["min_level"] for c in candidates)),
    )
    log.info(
        "Feature freq (top): %s",
        Counter(f for c in candidates for f in c["features"]).most_common(12),
    )

    # Active deck: balanced across levels
    by_level: dict[int, list[dict]] = defaultdict(list)
    for card in candidates:
        by_level[card["min_level"]].append(card)

    deck: list[dict] = []
    for level in range(1, 6):
        take = by_level[level][:deck_per_level]
        deck.extend(take)
        log.info("Level %d deck slice: %d (available %d)", level, len(take), len(by_level[level]))

    random.seed(7)
    random.shuffle(deck)

    pool = candidates[:pool_size]

    deck_out = [clean(card, i, "spa") for i, card in enumerate(deck, 1)]
    pool_out = [clean(card, i, "spa-pool") for i, card in enumerate(pool, 1)]
    return deck_out, pool_out


def write_json(path: Path, meta: dict, cards: list[dict]) -> None:
    path.write_text(
        json.dumps({"meta": meta, "cards": cards}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Path to sentences.tsv")
    parser.add_argument("--verbs", type=int, default=450, help="Top verbs to conjugate")
    parser.add_argument("--deck-per-level", type=int, default=250)
    parser.add_argument("--pool-size", type=int, default=10000)
    parser.add_argument("--rebuild-index", action="store_true")
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    sentences_path = args.input or download(SOURCE_URL, Path("/tmp/doozan-sentences.tsv"))
    frequency_path = download(FREQUENCY_URL, CACHE_DIR / "frequency.csv")

    index_path = CACHE_DIR / f"verb-forms-{args.verbs}.json"
    if args.rebuild_index and index_path.exists():
        index_path.unlink()

    verbs = load_top_verbs(frequency_path, limit=args.verbs)
    form_index = build_form_index(verbs, index_path)

    # Smoke tests
    for sample, verbs in (
        ("Él ya no está aquí.", ["está"]),
        ("Ayer fui a casa.", ["fui"]),
        ("Cuando era niño jugaba mucho.", ["era", "jugaba"]),
        ("Voy a comer ahora.", ["Voy", "comer"]),
        ("Si tuviera tiempo, viajaría más.", ["tuviera", "viajaría"]),
        ("Espero que vengas mañana.", ["Espero", "vengas"]),
        ("He comido ya.", ["He", "comido"]),
        ("Por favor, dime la verdad.", ["dime"]),
        ("Me crié en esta casa.", ["crié"]),
        ("No está en el menú.", ["está"]),
    ):
        feats, level = tag_sentence(sample, form_index, verbs)
        print(f"TAG [L{level}] {sample} → {feats}", flush=True)

    rows = load_rows(sentences_path)
    deck, pool = build(
        rows,
        form_index,
        deck_per_level=args.deck_per_level,
        pool_size=args.pool_size,
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    grammar_levels = {
        level: sorted(feat for feat, unlock in FEATURE_LEVEL.items() if unlock <= level)
        for level in range(1, 6)
    }

    base_meta = {
        "language": "Spanish",
        "pair": "spa-eng",
        "license": "CC BY 2.0 FR",
        "attribution": (
            "Sentence pairs from Tatoeba (https://tatoeba.org), licensed CC BY 2.0 FR. "
            "Filtered from doozan/spanish_data sentences.tsv. Grammar tags via verbecc conjugations."
        ),
        "source_urls": [
            "https://tatoeba.org/",
            "https://github.com/doozan/spanish_data",
            "https://github.com/bretttolbert/verbecc",
        ],
        "selection": (
            "Short phrases/sentences (2–12 Spanish words), grammar-tagged for Pimsleur-oriented "
            "level gating. Name-heavy and sensitive lines excluded."
        ),
        "feature_levels": FEATURE_LEVEL,
        "grammar_unlocks": grammar_levels,
        "filter_hint": (
            "Show a card at user level N when card.min_level <= N "
            "(equivalently: every feature is unlocked at N)."
        ),
    }

    deck_meta = {
        **base_meta,
        "count": len(deck),
        "buckets": dict(Counter(card["bucket"] for card in deck)),
        "min_levels": dict(Counter(card["min_level"] for card in deck)),
        "features": dict(Counter(f for card in deck for f in card["features"])),
    }
    pool_meta = {
        **base_meta,
        "count": len(pool),
        "selection": "Larger ranked pool for expanding the active deck.",
        "buckets": dict(Counter(card["bucket"] for card in pool)),
        "min_levels": dict(Counter(card["min_level"] for card in pool)),
        "features": dict(Counter(f for card in pool for f in card["features"])),
    }

    write_json(OUT_DIR / "phrases.json", deck_meta, deck)
    write_json(OUT_DIR / "phrases-pool.json", pool_meta, pool)
    (OUT_DIR / "grammar-levels.json").write_text(
        json.dumps(
            {
                "feature_levels": FEATURE_LEVEL,
                "unlocks": grammar_levels,
                "notes": (
                    "Level 1 is strict present / ir a / imperative. Past unlocks at 2, "
                    "imperfect+future at 3, conditional+present subjunctive at 4, "
                    "imperfect subjunctive / advanced perfects at 5."
                ),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    log.info("Wrote %d cards → %s", len(deck), OUT_DIR / "phrases.json")
    log.info("Wrote %d cards → %s", len(pool), OUT_DIR / "phrases-pool.json")


if __name__ == "__main__":
    main()
