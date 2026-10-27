"""Hindi keyword rules, applied to the original-language transcript.

These are a backstop for the translation path (see multilingual_intent.py), not a detector of their own: they catch the
clearest requests for codes, PINs and money when the machine translation loses them. They cover Devanagari and the
common romanized spellings Whisper sometimes produces. They were written by the developers,
not by native-speaker annotators, and have only been checked on small synthetic examples.

Hindi puts the verb last ("अपना OTP मुझे बताइए": "your OTP to-me tell"), so a request is a sensitive word followed,
within a few words, by an imperative verb. A negation right before that verb ("मत बताइए") turns it
into advice and the match is set aside, the same way "never share your OTP" is set aside in English.
"""

import re
from dataclasses import dataclass

from app.schemas_analysis import IntentIndicator, ModelInfo, TranscriptResult
from app.services.scam_intent import SEVERITY_RANK, segment_at

METHOD = ModelInfo(
    name="voxshield-indic-keyword-rules",
    revision="1.1",
    method="Hindi (Devanagari) and romanized keyword rules over the original transcript, with negation handling. No machine-learning model.",
)

# Python's \b treats Indic vowel signs as non-word characters, so it splits words in the middle. These boundaries count
# any letter or combining mark in the Devanagari block as part of a word. The danda (।, ॥: U+0964-5) sits
# in the Devanagari block but ends a sentence, so it is left out.
_LETTER = r"\w\u0900-\u0963\u0966-\u097F\u0A00-\u0A7F"
B = rf"(?<![{_LETTER}])"
E = rf"(?![{_LETTER}])"
GAP = rf"(?:[^\s।॥.?!,]+\s+){{0,{{n}}}}?"  # up to n words in the same clause


def _gap(n: int) -> str:
    return GAP.replace("{n}", str(n))


def _any(*words: str) -> str:
    return "(?:" + "|".join(words) + ")"


SENSITIVE = _any(
    # ओटीपी, plus the forms Whisper writes when it mishears it ("अव तीपी", "और तीपी", "ओ टीपी").
    r"(?:ओ|अव|और)?\s?[टत]ी\s?पी", r"ओटीपी", r"otp", r"o\s?t\s?p", r"पिन", r"पासवर्ड", r"पासकोड", r"कोड", r"सीवीवी", r"cvv",
    r"कार्ड\s+(?:नंबर|नम्बर)", r"(?:खाता|अकाउंट)\s+(?:नंबर|नम्बर)", r"आधार", r"एटीएम\s+पिन",
    r"pin", r"password", r"code", r"aadhaar", r"aadhar",
)
TELL = _any(
    r"बताइए", r"बताइये", r"बताएं", r"बताएँ", r"बताओ", r"बताये", r"बताना", r"बता\s+(?:दो|दीजिए|दीजिये|दें|देना)",
    r"भेजिए", r"भेजिये", r"भेजो", r"भेजें", r"भेज\s+(?:दो|दीजिए|दीजिये|दें)", r"दीजिए", r"दीजिये", r"दे\s+दो",  # bare "दो" is left out: it also means "two"
    r"बोलिए", r"बोलो", r"सुनाइए", r"पढ़िए", r"पढ़ो", r"शेयर\s+(?:कीजिए|कीजिये|करें|करो|कर\s+दो|कर\s+दीजिए)",
    r"batao", r"bataiye", r"bata\s+(?:do|dijiye|dena)", r"bhejo", r"bhej\s+do", r"bhejiye", r"dijiye", r"bolo",
    r"share\s+(?:karo|kijiye|karein|kar\s+do)", r"dasso", r"dass\s+deo",
)
MONEY = _any(
    r"पैसे", r"पैसा", r"रुपये", r"रुपए", r"रुपया", r"रकम", r"पेमेंट", r"अमाउंट", r"₹\s?\d[\d,]*", r"\d[\d,]*\s*(?:रुपये|रुपए|हज़ार|हजार|लाख)",
    r"paise", r"paisa", r"rupaye", r"rupees", r"payment",
)
PAY = _any(
    r"भेजिए", r"भेजिये", r"भेजो", r"भेजें", r"भेज\s+(?:दो|दीजिए|दीजिये|दें)",
    r"ट्रांसफर\s+(?:करो|कीजिए|कीजिये|करें|कर\s+दो|कर\s+दीजिए)", r"जमा\s+(?:करो|कीजिए|करें|कर\s+दो|करवाइए)",
    r"डाल\s+(?:दो|दीजिए)", r"डालिए", r"पे\s+(?:करो|कीजिए|करें|कर\s+दो)",
    r"bhejo", r"bhej\s+do", r"transfer\s+(?:karo|kar\s+do|kijiye)", r"jama\s+(?:karo|kar\s+do)", r"pay\s+karo",
)
# Word lists used inside the patterns (kept out of f-strings so this file also parses on Python 3.11).
NEGATION_WORDS = _any(r'मत', r'न', r'ना', r'नहीं', r'कभी', r'mat', r'na', r'nahi', r'nahin', r'kabhi')
REPORTING_WORDS = _any(r'ने\s+कहा', r'ने\s+बोला', r'ने\s+पूछा', r'कह\s+रहा\s+था', r'कह\s+रही\s+थी', r'ne\s+kaha', r'ne\s+bola')
CONJUNCTIONS = _any(r'और', r'लेकिन', r'पर', r'मगर', r'aur', r'lekin', r'par')
PAY_METHODS = _any(r'गिफ्ट\s+कार्ड', r'गिफ़्ट\s+कार्ड', r'बिटकॉइन', r'बिटकॉईन', r'क्रिप्टो', r'gift\s+card', r'bitcoin', r'crypto')
REMOTE_APPS = _any(r'anydesk', r'any\s+desk', r'teamviewer', r'team\s+viewer', r'एनीडेस्क', r'एनी\s+डेस्क', r'टीमव्यूअर', r'टीम\s+व्यूअर', r'स्क्रीन\s+शेयर', r'screen\s+share')
ARREST_WORDS = _any(r'गिरफ्तार', r'गिरफ़्तार', r'अरेस्ट', r'वारंट', r'giraftar', r'arrest', r'warrant')
ACCOUNT_WORDS = _any(r'खाता', r'खाते', r'अकाउंट', r'कार्ड', r'सिम', r'khata', r'account')
BLOCKED_WORDS = _any(r'बंद', r'बन्द', r'बन्ध', r'ब्लॉक', r'ब्लाक', r'फ्रीज़', r'फ्रीज', r'band', r'block')
URGENCY_WORDS = _any(r'तुरंत', r'तुरन्त', r'फौरन', r'फ़ौरन', r'अभी\s+के\s+अभी', r'जल्दी\s+(?:करो|कीजिए|करें)', r'turant', r'fauran', r'jaldi\s+karo')
ANYONE_WORDS = _any(r'किसी', r'घरवालों', r'घर\s+वालों', r'परिवार', r'kisi')
TO_WORDS = _any(r'को', r'से', r'ko', r'se')
EVEN_WORDS = _any(r'भी', r'bhi')
DONT_WORDS = _any(r'मत', r'न', r'ना', r'नहीं', r'mat', r'na')
TELL_INFINITIVES = _any(r'बताना', r'बताइए', r'बताएं', r'बताओ', r'बोलना', r'batana', r'batao')
CHECK_PLACES = _any(r'बैंक', r'ब्रांच', r'शाखा', r'पुलिस', r'bank', r'branch')
DONT_SHORT = _any(r'मत', r'न', r'ना', r'mat', r'na')
GO_OR_DO = _any(r'जाइए', r'जाना', r'जाएं', r'जाओ', r'करना', r'कीजिए', r'jana', r'jao', r'karna')
ORGS = _any(r'बैंक', r'पुलिस', r'सीबीआई', r'आरबीआई', r'कस्टम', r'इनकम\s+टैक्स', r'साइबर\s+क्राइम', r'bank', r'police')
FROM_WORDS = _any(r'से', r'se')
SPEAKING_WORDS = _any(r'बोल\s+रहा', r'बोल\s+रही', r'बात\s+कर\s+रहा', r'बात\s+कर\s+रही', r'bol\s+raha', r'bol\s+rahi')
# A negation directly before the verb ("मत बताइए"), or "never" anywhere earlier in the clause.
NEGATION = re.compile(rf"{B}{NEGATION_WORDS}{E}", re.I)
# Someone recounting what another person said: "उसने कहा कि ...".
REPORTED = re.compile(rf"{REPORTING_WORDS}", re.I)
SENSITIVE_WORD = re.compile(rf"{B}{SENSITIVE}{E}", re.I)
SENTENCE = re.compile(r"[^।॥.?!]+[।॥.?!]*")
CLAUSE_BREAK = re.compile(rf"[,;]|\s{CONJUNCTIONS}{E}", re.I)

CREDENTIAL_ACTION = "Do not share it. Hang up and contact the organization using a number you find yourself."
PAYMENT_ACTION = "Do not send money. Verify the request with the person or organization through an independent contact."


@dataclass(frozen=True)
class IndicRule:
    rule_id: str
    category: str
    severity: str
    pattern: re.Pattern[str]
    explanation: str
    action: str
    # The request is itself phrased with a negation ("किसी को मत बताना", don't tell anyone), so a negation is the signal.
    negation_is_signal: bool = False


def _rule(rule_id, category, severity, pattern, explanation, action, negation_is_signal=False) -> IndicRule:
    return IndicRule(rule_id, category, severity, re.compile(pattern, re.I), explanation, action, negation_is_signal)


RULES: list[IndicRule] = [
    _rule(
        "indic_cred_request", "credential_request", "high",
        rf"{B}{SENSITIVE}{E}\s+{_gap(5)}{TELL}{E}",
        "The speaker asks for a code, PIN, password, or similar secret (Hindi wording). Legitimate organizations do not ask you to read these out.",
        CREDENTIAL_ACTION,
    ),
    _rule(
        "indic_pay_request", "payment_pressure", "medium",
        rf"{B}{MONEY}{E}\s+{_gap(6)}{PAY}{E}",
        "The speaker asks you to send or transfer money (Hindi wording).",
        PAYMENT_ACTION,
    ),
    _rule(
        "indic_pay_method", "payment_pressure", "medium",
        rf"{B}{PAY_METHODS}{E}",
        "Payment through gift cards or cryptocurrency is mentioned. These are hard to reverse and commonly used in scams.",
        PAYMENT_ACTION,
    ),
    _rule(
        "indic_remote_access", "remote_access", "high",
        rf"{B}{REMOTE_APPS}{E}",
        "A remote-control or screen-sharing app is mentioned. These can expose bank accounts and passwords.",
        "Do not install anything. End the call and run a security check if you already did.",
    ),
    _rule(
        "indic_threat_legal", "coercion_threat", "medium",
        rf"{B}{ARREST_WORDS}{E}",
        "The speaker mentions arrest or a warrant. Government agencies do not demand payment or secrets over the phone.",
        "Do not act under pressure. Hang up and contact the agency through its official website or number.",
    ),
    _rule(
        "indic_threat_account", "coercion_threat", "medium",
        rf"{B}{ACCOUNT_WORDS}{E}\s+{_gap(6)}{BLOCKED_WORDS}{E}",
        "The speaker warns that an account or card will be blocked, a common pressure tactic. Real alerts exist too.",
        "Do not follow instructions from this call. Check your account through the official app or website.",
    ),
    _rule(
        "indic_urgency", "urgency", "low",
        rf"{B}{URGENCY_WORDS}{E}",
        "Time pressure is used to stop people from thinking or checking. It is only a weak signal by itself.",
        "Slow down. Legitimate requests can wait while you verify them.",
    ),
    _rule(
        "indic_secrecy", "secrecy_isolation", "medium",
        rf"{B}{ANYONE_WORDS}{E}\s+{TO_WORDS}\s+(?:{EVEN_WORDS}\s+)?{DONT_WORDS}\s+{TELL_INFINITIVES}{E}",
        "The speaker tells you not to tell anyone. Isolation is a hallmark of scams.",
        "Talk to someone you trust before doing anything. Genuine requests survive a second opinion.",
        negation_is_signal=True,
    ),
    _rule(
        "indic_bypass_verify", "verification_bypass", "high",
        rf"{B}{CHECK_PLACES}{E}\s+{_gap(3)}{DONT_SHORT}\s+{GO_OR_DO}{E}",
        "The speaker discourages contacting the bank, branch or police, the normal checks that would expose a scam.",
        "Do the opposite: hang up and verify through an independently obtained official number.",
        negation_is_signal=True,
    ),
    _rule(
        "indic_imp_org", "impersonation", "low",
        rf"{B}{ORGS}{E}\s+{FROM_WORDS}\s+{_gap(2)}{SPEAKING_WORDS}",
        "The speaker says they represent an organization. VoxShield cannot verify this from audio, and real organizations also call customers.",
        "Do not rely on the caller's claim. Contact the organization using an official number you find yourself.",
    ),
]


def _clauses(sentence: str, offset: int) -> list[tuple[int, int]]:
    spans, start = [], 0
    for m in CLAUSE_BREAK.finditer(sentence):
        spans.append((start, m.start()))
        start = m.end()
    spans.append((start, len(sentence)))
    return [(offset + s, offset + e) for s, e in spans if sentence[s:e].strip()]


def _negated(clause: str, match: re.Match[str]) -> bool:
    """A negation inside the match (before its verb) or in the clause before it marks the sentence as advice."""
    return bool(NEGATION.search(clause[: match.end()]))


def _indicator(transcript: TranscriptResult, rule: IndicRule, start: int, end: int, sentence: str, reported: bool) -> IntentIndicator:
    segment = segment_at(transcript, start)
    return IntentIndicator(
        id=f"{rule.rule_id}-{start}",
        rule_id=rule.rule_id,
        category=rule.category,
        severity="low" if reported else rule.severity,
        segment_index=segment.index if segment else None,
        char_start=start,
        char_end=end,
        start_seconds=segment.start_seconds if segment else None,
        end_seconds=segment.end_seconds if segment else None,
        excerpt=transcript.text[start:end],
        sentence=sentence.strip(),
        context="reported" if reported else "direct",
        detector="rules",
        trigger=(
            f"Hindi keyword rule '{rule.rule_id}' matched this wording in the original-language transcript. "
            + ("It comes after a cue that someone is recounting what was said, so it does not raise the risk level."
               if reported else "No negation came before the verb in the same clause.")
        ),
        explanation=rule.explanation,
        suggested_action=rule.action,
    )


def find_indicators(transcript: TranscriptResult) -> tuple[list[IntentIndicator], int]:
    """Native-language keyword findings in the original transcript, and how many matches were set aside as advice."""
    text = transcript.text
    found: list[IntentIndicator] = []
    suppressed = 0
    for sentence_match in SENTENCE.finditer(text):
        sentence = sentence_match.group()
        reported_from = REPORTED.search(sentence)
        hits: list[tuple[IndicRule, int, int]] = []
        for start, end in _clauses(sentence, sentence_match.start()):
            clause = text[start:end]
            for rule in RULES:
                for match in rule.pattern.finditer(clause):
                    if not rule.negation_is_signal and _negated(clause, match):
                        suppressed += 1
                        continue
                    hits.append((rule, start + match.start(), start + match.end()))
        # A sentence that mentions a code or PIN without asking for one ("the bank never asks for your PIN, so don't tell
        # anyone") is advice, and its "don't tell anyone" is not a request for secrecy.
        advice = bool(SENSITIVE_WORD.search(sentence)) and not any(rule.category == "credential_request" for rule, _, _ in hits)
        for rule, start, end in hits:
            if rule.negation_is_signal and advice:
                suppressed += 1
                continue
            reported = bool(reported_from and sentence_match.start() + reported_from.end() <= start)
            candidate = _indicator(transcript, rule, start, end, sentence, reported)
            clash = next((i for i in found if i.category == candidate.category and i.char_start < candidate.char_end and candidate.char_start < i.char_end), None)
            if clash is None:
                found.append(candidate)
            elif SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[clash.severity]:
                found[found.index(clash)] = candidate
    found.sort(key=lambda i: i.char_start)
    return found, suppressed
