"""Small synthetic set for the false-positive problem found after Stage 2: protective, ambiguous, and quoted text that
shares vocabulary with scams, plus genuinely suspicious requests (some of which also contain protective language).

ORIGIN: written by hand by the AI assistant that fixed the problem. Fixing the detector was guided by a handful of
probe sentences (the user's bank-awareness transcript and seven regression sentences, which are in
tests/test_scam_intent_context.py). The cases below were written BEFORE the fix and are worded differently, and were
run once before and once after it. They are still synthetic, tiny, and written by the same author, so they show how the
detector handles the situations we thought of, not real-world accuracy.

KINDS
  benign      awareness or protective messages. Expected: no direct finding of medium or high severity.
  ambiguous   vague account or call wording without a suspicious request. Same expectation.
  quoted      someone recounts or quotes a scam. Expected: no direct finding of medium or high severity (reported
              findings of low severity are fine and are kept so the user can see them).
  suspicious  the speaker directly makes the request in `expect` (a category). Expected: that category is found as a
              direct finding, even when protective language appears elsewhere in the same message.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Case:
    id: str
    kind: str
    text: str
    expect: str | None = None  # category that must be found directly (suspicious only)


CASES: tuple[Case, ...] = (
    Case("b1", "benign", "Good afternoon, this is your credit union with an important notice about card security. We will never call you to ask for your PIN. If you receive such a call, hang up and dial the number on the back of your card."),
    Case("b2", "benign", "Remember that your bank will not request your online banking password by phone or text. Please do not give it to anyone, even if they seem to know your name."),
    Case("b3", "benign", "Thank you for banking with us. Fraudsters sometimes pretend to be bank staff and ask for one-time passcodes. Keep your passcode private and report any such call to our fraud line."),
    Case("b4", "benign", "If someone pressures you to act urgently, stop and talk to a family member or your branch before you do anything."),
    Case("b5", "benign", "To protect your account, enable two-factor authentication and never reuse your password on other sites."),
    Case("b6", "benign", "This message is a reminder that you should check your statements every month and report anything you do not recognize through the official mobile app."),
    Case("b7", "benign", "Do not trust caller ID alone. Hang up and call back using a number you have looked up yourself."),
    Case("b8", "benign", "Please keep your security code to yourself and do not disclose it to anyone, including bank employees."),
    Case("a1", "ambiguous", "We noticed some unusual transactions on your card ending in 4421."),
    Case("a2", "ambiguous", "Your account requires attention, so please log in to the official app when you have a moment."),
    Case("a3", "ambiguous", "This is a courtesy call about your recent application. We will call again tomorrow."),
    Case("a4", "ambiguous", "Please call us back as soon as you can regarding your delivery."),
    Case("q1", "quoted", "My neighbour got a call yesterday where the man said read me the code on your phone, and she almost did."),
    Case("q2", "quoted", "The email I received said please confirm your password at this link, which is obviously a phishing attempt."),
    Case("q3", "quoted", "In a common scam the caller says your account is frozen and asks you to transfer money to a safe account."),
    Case("q4", "quoted", "The fraudster told her not to tell anyone and not to call her bank."),
    Case("q5", "quoted", "A text arrived saying send me your PIN right now, so I reported it."),
    Case("s1", "suspicious", "I am from the fraud team. To cancel the transaction, read me the six digit code you just received.", "credential_request"),
    Case("s2", "suspicious", "Quickly give me your card PIN so I can verify that it is you.", "credential_request"),
    Case("s3", "suspicious", "Do not tell your bank or your family about this, it must stay between us.", "secrecy_isolation"),
    Case("s4", "suspicious", "Do not call your bank to check, just do what I say.", "verification_bypass"),
    Case("s5", "suspicious", "You need to wire two thousand dollars today or the police will arrest you.", "payment_pressure"),
    Case("s6", "suspicious", "Install the remote support app now and let me see your screen so I can fix your account.", "remote_access"),
    Case("s7", "suspicious", "Never share your code with strangers, but I need you to read me the code that just arrived.", "credential_request"),
    Case("s8", "suspicious", "Please remember that scammers exist. Now, tell me your online banking password to confirm your identity.", "credential_request"),
    Case("s9", "suspicious", "Your bank advises never to disclose your OTP. However, for this verification I need you to tell me your OTP.", "credential_request"),
    Case("s10", "suspicious", "Keep this call secret from your family, and also never share your code with your bank.", "secrecy_isolation"),
)
