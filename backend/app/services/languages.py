"""The languages VoxShield can be asked to transcribe, and what is known about each.

Three separate facts, kept apart on purpose:
  * transcription: the multilingual Whisper model can be asked for English or Hindi, or left to detect the language;
  * scam-intent detection: both detectors were written and checked on English text. Hindi and Urdu speech is checked
    through Whisper's own English translation of the audio (plus Hindi keyword rules on the original transcript); every
    other language, Punjabi included, is reported as "not validated" instead of being run through them;
  * voice authenticity: the audio classifier was checked on VoxShield's small read-speech benchmark, which is not the
    same as real calls.
The transcript is always in the language that was spoken. A translation, when made, is kept beside it, never in its place.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.schemas_analysis import TranscriptResult

AUTO = "auto"


@dataclass(frozen=True)
class LanguageOption:
    code: str  # what a client sends; for real languages this is also the Whisper language code
    name: str


# What a client may ask for. Auto-detection can still report other languages in its result.
SELECTABLE: tuple[LanguageOption, ...] = (
    LanguageOption(AUTO, "Auto-detect"),
    LanguageOption("en", "English"),
    LanguageOption("hi", "Hindi"),
)
SELECTABLE_CODES = frozenset(option.code for option in SELECTABLE)

# Names for codes that auto-detection may return, in addition to the selectable ones. Unknown codes are shown as the code.
_OTHER_NAMES = {
    "ur": "Urdu", "pa": "Punjabi", "bn": "Bengali", "gu": "Gujarati", "mr": "Marathi", "ta": "Tamil", "te": "Telugu", "kn": "Kannada",
    "ml": "Malayalam", "ne": "Nepali", "sa": "Sanskrit", "si": "Sinhala", "es": "Spanish", "fr": "French", "de": "German",
    "pt": "Portuguese", "it": "Italian", "ru": "Russian", "ar": "Arabic", "fa": "Persian", "tr": "Turkish", "id": "Indonesian",
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
}
NAMES = {option.code: option.name for option in SELECTABLE if option.code != AUTO} | _OTHER_NAMES

# Languages the scam-intent detectors were built and checked on. Everything else is "not validated", never "safe".
SCAM_DETECTION_LANGUAGES = frozenset({"en"})
# Languages checked through an English translation of the speech. Urdu is included because Hindi speech is often detected
# as Urdu, and the spoken languages overlap heavily. Detection here is not validated, and the report says so.
TRANSLATED_SCAM_LANGUAGES = frozenset({"hi", "ur"})

ScamRoute = Literal["direct", "translated", "not_run"]

# Heuristic: in manual mode the model's own guess must beat this to be called a mismatch with what was selected.
MISMATCH_SCORE = 0.7

VOICE_NOTE = (
    "The voice check was tested by VoxShield only on read speech and computer voices, not on real calls. It caught "
    "neural voices far more often in English than in Hindi, so a 'real' lean outside English is weak evidence. Its "
    "score is a model output and says nothing about what is said."
)
TRANSCRIPTION_NOTE = (
    "Hindi is transcribed by the same small multilingual speech-to-text model used for English. VoxShield has not "
    "measured its accuracy in Hindi, and it is expected to make more mistakes than in English, so check the "
    "transcript against the audio."
)
TRANSLATION_NOTE = (
    "Scam detection for this language runs on a machine translation into English, made by the same speech-to-text model "
    "from the audio, plus Hindi keyword rules on the original transcript. VoxShield has not measured how "
    "accurate this is. A mistranslation can add or hide a finding, so compare each finding with the original sentence."
)
ALLOWED_TEXT = ", ".join(option.code for option in SELECTABLE)


class UnsupportedLanguage(ValueError):
    """The requested language is not one of SELECTABLE."""


def parse_requested_language(value: str | None) -> str:
    """The language a client asked for, as one of SELECTABLE_CODES. A missing or empty value means auto-detect, so
    clients written before this option existed behave exactly as before."""
    if value is None or not value.strip():
        return AUTO
    cleaned = value.strip().lower()
    if len(cleaned) > 16 or cleaned not in SELECTABLE_CODES:
        raise UnsupportedLanguage(f"Unsupported language. Choose one of: {ALLOWED_TEXT}.")
    return cleaned


def whisper_code(requested: str) -> str | None:
    """The language code to hand to Whisper, or None to let it detect the language."""
    return None if requested == AUTO else requested


def language_name(code: str | None) -> str | None:
    return None if code is None else NAMES.get(code, code)


def _mostly_non_latin(text: str) -> bool:
    """True when most letters are outside the Latin alphabet, so the text cannot be English the detectors could read."""
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return False
    latin = sum(1 for ch in letters if ch.isascii() or "\u00c0" <= ch <= "\u024f")
    return latin / len(letters) < 0.5


def scam_detection_route(transcript: "TranscriptResult") -> tuple[ScamRoute, str | None]:
    """How scam-intent detection may treat this transcript, and why when it may not run at all.

    "direct": the English detectors read the transcript itself. "translated": they read an English translation of the
    audio instead. "not_run": no scam result is made; the note says why. "Not run" is not "safe": nothing is concluded."""
    if transcript.language_mismatch:
        selected = language_name(transcript.language)
        heard = language_name(transcript.detected_language)
        return "not_run", (
            f"You selected {selected}, but the audio sounded like {heard}, so the transcript may not match what was said "
            "and no scam result is shown. Check the language and analyze again."
        )
    code = transcript.language
    if code is None or code in SCAM_DETECTION_LANGUAGES:
        return "direct", None
    if code in TRANSLATED_SCAM_LANGUAGES:
        return "translated", None
    # A weak language guess normally does not block, so English speech misheard as another language is still checked. A
    # transcript written mostly in another script cannot be that case (Whisper often detects Punjabi near 0.5 and writes
    # it in Devanagari), so it is never handed to the English detectors.
    confident = (transcript.language_probability or 1.0) >= 0.5
    if transcript.language_source == "selected" or confident or _mostly_non_latin(transcript.text):
        return "not_run", (
            f"Scam detection is not validated for {language_name(code)}. VoxShield's scam-intent detectors were built and "
            "checked on English text, and only Hindi and Urdu are checked through a translation, so no scam "
            "result is shown for this recording."
        )
    return "direct", None  # a weak, unconfirmed language guess does not block (the transcript already carries a low-confidence note)


def scam_detection_block(transcript: "TranscriptResult") -> str | None:
    """Why the English detectors must not read this transcript's text, or None when they may. Used by both detectors, so
    they always agree. Hindi and Urdu text is blocked too: the pipeline hands the detectors an English
    translation of that speech instead, never the original-script text."""
    route, note = scam_detection_route(transcript)
    if route == "translated":
        return (
            f"The English scam detectors cannot read {language_name(transcript.language)} text directly. VoxShield checks "
            "this language through an English translation of the audio."
        )
    return note
