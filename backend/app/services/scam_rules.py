import re
from dataclasses import dataclass

I = re.IGNORECASE

SENSITIVE = (
    r"(?:one[\s-]?time[\s-]?(?:password|passcode|pin|code)|otp|verification\s+code|security\s+code|"
    r"authentication\s+code|auth\s+code|(?:6|six)[\s-]?digit\s+code|"
    r"(?:(?:atm|debit|card|bank|account|login|online\s+banking|net\s*banking|secret)\s+)?pin(?:\s+number)?|"
    r"password|passcode|cvv|cvc|card\s+number|account\s+number|routing\s+number|"
    r"social\s+security(?:\s+number)?|ssn|aadhaar|net\s*banking\s+(?:id|credentials|details)|login\s+(?:details|credentials))"
)
MONEY = (
    r"(?:money|funds|cash|payment|amount|(?:\$|rs\.?|₹|£|€)\s?\d[\d,\.]*|\d[\d,\.]*\s*(?:dollars|rupees|bucks|euros|pounds|usd|inr)|(?:\w+\s+){1,2}(?:dollars|rupees|bucks|euros|pounds))"
)
PAY_METHOD = (
    r"(?:gift\s+cards?|itunes\s+cards?|google\s+play\s+cards?|steam\s+cards?|bitcoin|btc|crypto(?:currency)?|"
    r"western\s+union|moneygram)"
)
ORGS = (
    r"(?:bank|police(?:\s+department)?|fbi|irs|internal\s+revenue(?:\s+service)?|income\s+tax(?:\s+department)?|"
    r"tax\s+department|customs|immigration|social\s+security(?:\s+administration)?|cyber\s*crime|cbi|microsoft|apple|"
    r"amazon|google|paypal|visa|mastercard|the\s+court|government|fraud\s+(?:department|team|prevention)|"
    r"security\s+department|(?:technical|tech)\s+support)"
)
RELATIVE = r"(?:grand(?:son|daughter|ma|pa|mother|father)|son|daughter|mom|mum|dad|nephew|niece|uncle|aunt|brother|sister)"
WORDS = r"(?:\w+\s+)"


@dataclass(frozen=True)
class Rule:
    rule_id: str
    category: str
    severity: str
    pattern: re.Pattern[str]
    explanation: str
    action: str
    negation_is_signal: bool = False


def _rule(rule_id, category, severity, pattern, explanation, action, negation_is_signal=False) -> Rule:
    return Rule(rule_id, category, severity, re.compile(pattern, I), explanation, action, negation_is_signal)


RULES: list[Rule] = [
    _rule(
        "cred_ask_me", "credential_request", "high",
        rf"\b(?:tell|give|read|send|share|provide|forward|text|repeat|say)\s+(?:me|us)\s+{WORDS}{{0,4}}?{SENSITIVE}\b",
        "The speaker asks for a code, PIN, password, or similar secret. Legitimate organizations do not ask you to read these out.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    _rule(
        "cred_read_out", "credential_request", "high",
        rf"\b(?:read|say|speak|call)\s+out\s+{WORDS}{{0,4}}?{SENSITIVE}\b",
        "The speaker asks you to read out a code, PIN, password, or similar secret.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    _rule(
        "cred_your", "credential_request", "high",
        rf"\b(?:share|provide|give|confirm|tell|verify|disclose|reveal|read|send)\s+{WORDS}{{0,2}}?your\s+{WORDS}{{0,3}}?{SENSITIVE}\b",
        "The speaker asks you to hand over a code, PIN, password, or account detail.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    _rule(
        "cred_need", "credential_request", "high",
        rf"\b(?:what(?:'s|\s+is)|may\s+i\s+have|can\s+i\s+(?:get|have)|i\s+need|we\s+need|i\s+require|we\s+require)\s+{WORDS}{{0,3}}?(?:your|the)\s+{WORDS}{{0,3}}?{SENSITIVE}\b",
        "The speaker asks for a code, PIN, password, or account detail.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    _rule(
        "cred_ask_for", "credential_request", "high",
        rf"\b(?:ask(?:ing)?|asked|request(?:ing)?)\s+(?:you\s+)?for\s+(?:your|the)\s+{WORDS}{{0,3}}?{SENSITIVE}\b",
        "The speaker asks you for a code, PIN, password, or account detail.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    _rule(
        "cred_directive", "credential_request", "high",
        rf"\b(?:you\s+(?:must|should|(?:need|have|will)\s+to)|please)\s+(?:tell|share|give|read|provide|send|confirm)\s+{WORDS}{{0,4}}?{SENSITIVE}\b",
        "The speaker directs you to give out a code, PIN, password, or account detail.",
        "Do not share it. Hang up and contact the organization using a number you find yourself.",
    ),
    _rule(
        "pay_method", "payment_pressure", "medium",
        rf"\b(?:buy|purchase|pay|send|transfer|wire|deposit|use|load)\b(?:\s+\w+){{0,6}}?\s+{PAY_METHOD}\b",
        "Payment is requested through a method that is hard to reverse and commonly used in scams.",
        "Do not pay. Verify the request with the organization or person through an independent contact.",
    ),
    _rule(
        "pay_send_me", "payment_pressure", "medium",
        rf"\b(?:send|wire|transfer)\s+(?:me|us)\s+{WORDS}{{0,3}}?{MONEY}",
        "The speaker asks you to send them money.",
        "Do not send money. Confirm the request by calling the person on a number you already know.",
    ),
    _rule(
        "pay_need_money", "payment_pressure", "low",
        rf"\bi\s+need\s+(?:you\s+to\s+send\s+me\s+)?(?:some\s+|a\s+lot\s+of\s+)?{MONEY}",
        "The speaker says they need money. Friends and family ask this too, so it is only a weak signal on its own.",
        "Before sending anything, confirm the request by calling the person on a number you already know.",
    ),
    _rule(
        "pay_directive", "payment_pressure", "low",
        rf"\b(?:you\s+(?:must|should|(?:need|have)\s+to)|i\s+need\s+you\s+to|please|immediately|right\s+now)\s+{WORDS}{{0,3}}?(?:transfer|wire|send|pay|deposit|remit)\b(?:\s+\w+){{0,6}}?\s+{MONEY}",
        "The speaker directs you to move money. This is only a weak signal on its own.",
        "Pause before paying. Verify who is asking and why through an independent channel.",
    ),
    _rule(
        "pay_withdraw", "payment_pressure", "medium",
        rf"\b(?:you\s+(?:must|should|(?:need|have)\s+to)|go\s+(?:to\s+\w+\s+)?and|please)\s+withdraw\b(?:\s+\w+){{0,4}}?\s+(?:cash|money|savings|\$\s?\d[\d,]*)",
        "The speaker tells you to withdraw cash, a common step in scams that use couriers or cash drops.",
        "Do not withdraw money for a caller. Speak to your bank in person or on a number you look up yourself.",
    ),
    _rule(
        "imp_org", "impersonation", "low",
        rf"\b(?:this\s+is|i\s*(?:am|'m)|we\s*(?:are|'re)|calling|speaking)\s+(?!(?:an?|the|your|just|only|not|about|regarding|to|in)\b)(?:\w+\s+){{0,4}}?(?:from|with|at)\s+(?:the\s+)?(?:your\s+)?(?:\w+\s+){{0,2}}?{ORGS}\b",
        "The speaker says they represent an organization. VoxShield cannot verify this from audio, and real organizations also call customers.",
        "Do not rely on the caller's claim. Contact the organization using an official number you find yourself.",
    ),
    _rule(
        "imp_org_direct", "impersonation", "low",
        rf"\b(?:this\s+is|we\s+are)\s+(?:your\s+|the\s+)?{ORGS}\b",
        "The speaker says they are an organization. VoxShield cannot verify this from audio, and real organizations also call customers.",
        "Do not rely on the caller's claim. Contact the organization using an official number you find yourself.",
    ),
    _rule(
        "imp_officer", "impersonation", "low",
        r"\b(?:this\s+is|i\s*(?:am|'m))\s+(?:an?\s+)?(?:officer|detective|inspector|special\s+agent|agent|sergeant|investigator)\b",
        "The speaker claims an official or law-enforcement role, which cannot be verified from audio.",
        "Ask for a name and department, then verify through the agency's published phone number.",
    ),
    _rule(
        "imp_relative", "impersonation", "medium",
        rf"\b(?:it(?:'s|\s+is)\s+me[,\s]+(?:your\s+)?{RELATIVE}|(?:this\s+is|i\s*(?:am|'m))\s+your\s+{RELATIVE})\b",
        "The speaker claims to be a relative. Cloned voices are often used for this.",
        "Hang up and call the relative on the number you already have, or ask a question only they could answer.",
    ),
    _rule(
        "imp_emergency", "impersonation", "medium",
        rf"\b(?:i(?:'m|\s+am)\s+in\s+(?:jail|trouble|custody|the\s+hospital)|i(?:'ve|\s+have)\s+been\s+(?:arrested|in\s+an?\s+accident|kidnapped)|your\s+{RELATIVE}\s+(?:is|has\s+been)\s+(?:in\s+(?:jail|trouble|custody|the\s+hospital)|arrested|kidnapped|hurt))\b",
        "The speaker describes a family emergency, a common way to rush people into sending money.",
        "Stay calm. Contact the family member or another relative directly on a number you already have.",
    ),
    _rule(
        "threat_legal", "coercion_threat", "medium",
        r"\b(?:you\s+(?:will|are\s+going\s+to|'ll)\s+(?:be\s+)?(?:arrested|jailed|prosecuted|sued|deported|fined|charged)|arrest\s+warrant|warrant\s+(?:has\s+been|is|was)\s+(?:issued|out)|legal\s+action|face\s+(?:charges|jail|prosecution|arrest))\b",
        "The speaker threatens arrest or legal trouble. Government agencies do not demand payment or secrets over the phone.",
        "Do not act under pressure. Hang up and contact the agency through its official website or number.",
    ),
    _rule(
        "threat_account", "coercion_threat", "medium",
        rf"\b(?:your\s+)?(?:account|card|number|connection|service|social\s+security\s+number)\s+(?:will\s+be|has\s+been|is\s+going\s+to\s+be|was)\s+(?:\w+\s+)?(?:blocked|suspended|closed|frozen|deactivated|terminated|cancel+ed|compromised)\b",
        "The speaker warns that an account will be blocked or has been compromised, a common pressure tactic. Real alerts exist too.",
        "Do not follow instructions from this call. Check your account through the official app or website.",
    ),
    _rule(
        "urgency", "urgency", "low",
        r"\b(?:urgent(?:ly)?|immediately|right\s+now|right\s+away|at\s+once|asap|as\s+soon\s+as\s+possible|act\s+(?:now|fast|quickly)|(?:within|in)\s+(?:the\s+next\s+)?(?:\d+|one|two|three|five|ten|fifteen|thirty|an?)\s+(?:minutes?|hours?)|before\s+it(?:'s|\s+is)\s+too\s+late|time\s+is\s+running\s+out|last\s+chance|today\s+only)\b",
        "Time pressure is used to stop people from thinking or checking. It is only a weak signal by itself.",
        "Slow down. Legitimate requests can wait while you verify them.",
    ),
    _rule(
        "stay_on_line", "urgency", "low",
        r"\b(?:don't|do\s+not|dont|never)\s+hang\s+up\b|\bstay\s+on\s+the\s+(?:line|phone)\b",
        "Being told to stay on the line prevents you from checking with anyone else.",
        "Hang up. You can always call back on a number you trust.",
        negation_is_signal=True,
    ),
    _rule(
        "secrecy_tell", "secrecy_isolation", "medium",
        rf"\b(?:don't|do\s+not|dont|never|can't|cannot|must\s+not|shouldn't|should\s+not)\s+(?:tell|inform|mention|discuss|say\s+anything|let|talk\s+to|speak\s+to|involve|call|contact)\b(?:\s+\w+){{0,4}}?\s+(?:anyone|anybody|no\s*one|nobody|(?:your\s+)?(?:family|wife|husband|parents|mom|dad|mother|father|son|daughter|friends?|bank|manager|branch|lawyer|colleagues?|police|neighbou?rs?))\b",
        "The speaker tells you not to involve other people. Isolation is a hallmark of scams.",
        "Talk to someone you trust before doing anything. Genuine requests survive a second opinion.",
        negation_is_signal=True,
    ),
    _rule(
        "secrecy_keep", "secrecy_isolation", "medium",
        r"\b(?:keep|kept)\s+(?:this|it|that|everything)\s+(?:a\s+)?(?:secret|between\s+us|confidential|private|quiet|to\s+yourself)\b|\bbetween\s+(?:you\s+and\s+me|us)\b|\bno\s*one\s+(?:should|needs\s+to|can)\s+know\b",
        "The speaker asks you to keep the conversation secret.",
        "Talk to someone you trust before doing anything. Genuine requests survive a second opinion.",
        negation_is_signal=True,
    ),
    _rule(
        "bypass_verify", "verification_bypass", "high",
        r"\b(?:don't|do\s+not|dont|never|no\s+need\s+to|skip|bypass)\s+(?:try\s+to\s+)?(?:verify|verification|call\s+(?:the\s+|your\s+)?(?:bank|back|branch|number|police)|go\s+to\s+(?:the\s+|your\s+)?(?:bank|branch|police)|visit\s+(?:the\s+|your\s+)?(?:bank|branch)|check\s+with\s+(?:the\s+|your\s+)?(?:bank|branch|family))\b",
        "The speaker discourages the normal checks that would expose a scam.",
        "Do the opposite: hang up and verify through an independently obtained official number.",
        negation_is_signal=True,
    ),
    _rule(
        "remote_access", "remote_access", "high",
        rf"\b(?:install|download|open|launch|use)\b(?:\s+\w+){{0,3}}?\s+(?:anydesk|any\s+desk|teamviewer|team\s+viewer|ultraviewer|quicksupport|quick\s+support|ammyy|logmein|remote\s+(?:access|desktop|support)|screen[\s-]?shar\w+)|\b(?:give|grant|allow)\s+(?:me|us)\s+(?:\w+\s+){{0,2}}?(?:remote\s+)?access\s+to\s+your\b",
        "The speaker asks for remote control of your device, which can expose bank accounts and passwords.",
        "Do not install anything. End the call and run a security check if you already did.",
    ),
]

NEGATION = re.compile(
    r"\b(?:never|not|don't|dont|doesn't|does\s+not|didn't|won't|wouldn't|shouldn't|can't|cannot|no\s+one\s+will|nobody\s+will|"
    r"without|no\s+need|no\s+rush)\b",
    I,
)
# Where one clause ends and an unrelated one begins, so a negation does not reach across it. A comma only counts when
# a new clause visibly starts after it ("..., and do it", "..., it is urgent"), which keeps "Never, under any
# circumstances, share ..." as one negated clause.
CLAUSE_BREAK = re.compile(
    r"[;:\u2014\u2013]|\s-\s|"
    r",\s*(?=(?:and|but|so|then|because|yet|it(?:'s|\s+is)|this\s+is|that(?:'s|\s+is)|you\s+(?:must|need|have|should|will))\b)"
    r"|\b(?:but|because|however|although|though|so|then)\b",
    I,
)
# Someone is describing a request they received or heard, not making it themselves.
REPORTING = re.compile(
    r"\b(?:(?:he|she|they|someone|somebody|man|woman|guy|lady|caller|scammers?|fraudsters?|people|callers|email|text|message)\s+"
    r"(?:\w+\s+){0,2}?(?:said|says|saying|asked|asks|claimed|claims|told|tells|wrote|texted|demanded|threatened|insisted)"
    r"|(?:told|asked|texted|warned)\s+(?:me|us|him|her|them)"
    r"|(?:scammers?|fraudsters?|callers?|criminals?)\s+(?:\w+\s+){0,2}?(?:say|ask|tell|claim|pretend|use)"
    r"|(?:offered|promised|agreed|volunteered)\s+to"
    r"|for\s+(?:example|instance)|such\s+as|like\s+when|quote|unquote)\b",
    I,
)
QUOTE_MARKS = re.compile(r"[\"\u201c\u201d]")
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def split_sentences(text: str) -> list[tuple[int, int]]:
    spans, start = [], 0
    for m in SENTENCE_END.finditer(text):
        spans.append((start, m.start()))
        start = m.end()
    spans.append((start, len(text)))
    return [(s, e) for s, e in spans if e > s]


def is_reported(sentence_prefix: str) -> bool:
    """True if the match sits inside quoted speech or after a cue that someone is recounting a request."""
    if len(QUOTE_MARKS.findall(sentence_prefix)) % 2 == 1:
        return True
    tail = " ".join(sentence_prefix.split()[-20:])
    return bool(REPORTING.search(tail))


def current_clause(sentence_prefix: str) -> str:
    """The part of the prefix after the last clause break: the only text a negation can modify."""
    last = None
    for last in CLAUSE_BREAK.finditer(sentence_prefix):
        pass
    return sentence_prefix[last.end() :] if last else sentence_prefix


def is_negated(sentence_prefix: str) -> bool:
    """True if a negation cue appears within the last eight words of the same clause as the match."""
    tail = " ".join(current_clause(sentence_prefix).split()[-8:])
    return bool(NEGATION.search(tail))
