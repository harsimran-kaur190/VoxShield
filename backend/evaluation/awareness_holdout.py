"""Second, fresh set for the same false-positive fix. Written AFTER the detector had been tuned on awareness_cases.py,
with new wording, and run once, so it is a fairer (but still tiny, synthetic, same-author) check than that set.
`adversarial` cases pair protective or narrated wording with a real request in the same message: they must still be
found directly. Kinds and rules are the same as in awareness_cases.py.
"""

from evaluation.awareness_cases import Case

CASES: tuple[Case, ...] = (
    Case("h1", "benign", "Hi, this is an automated security notice from your lender. For your protection we never ask customers to confirm a passcode by phone. If anyone does, end the call and use the number printed on your statement."),
    Case("h2", "benign", "Voice cloning technology can make a caller sound exactly like someone you know. If a relative asks for money in a rush, call them back on their saved number before you send anything."),
    Case("h3", "benign", "Never click links in unexpected texts, and do not enter your login details on a page you reached from a message."),
    Case("h4", "benign", "Your appointment is confirmed for Thursday at ten. Please bring photo identification and your insurance card."),
    Case("h5", "benign", "We are updating our records. You can review your details at any time by signing in on our official website."),
    Case("h6", "benign", "Treat any request for your banking PIN as a warning sign, and talk to your branch if you are unsure."),
    Case("h7", "ambiguous", "There has been some activity on your account that you may want to look at."),
    Case("h8", "ambiguous", "Hello, I am calling about the payment on your account. Could you call me back this afternoon?"),
    Case("h9", "quoted", "She told me the caller kept saying give me your verification code, and she hung up on him."),
    Case("h10", "quoted", "The voicemail said you must pay today or face arrest, and I knew immediately that it was a scam."),
    Case("h11", "quoted", "Fraud awareness training explains that a typical scam begins with someone claiming to be from the bank who then asks you to move your savings."),
    Case("h12", "suspicious", "This is the security desk. We have blocked a payment, so confirm your banking password now and we will release it.", "credential_request"),
    Case("h13", "suspicious", "Do not mention this to your bank or anyone in your family, otherwise the account will be locked for good.", "secrecy_isolation"),
    Case("h14", "suspicious", "Skip the branch and do not phone your bank back, I will handle everything from here.", "verification_bypass"),
    Case("h15", "suspicious", "Transfer the whole balance into the holding account I am giving you, and do it before the office closes.", "payment_pressure"),
    Case("adv1", "suspicious", "Never give your code to strangers, so please give your code to me and I will confirm it is safe.", "credential_request"),
    Case("adv2", "suspicious", "Banks tell you not to share your password with callers. Share your password with me now and the block will lift.", "credential_request"),
    Case("adv3", "suspicious", "It is wise to verify callers, yet this time please do not check with your bank, just stay on the line with me.", "verification_bypass"),
    Case("adv4", "suspicious", "Normally you should tell your family about calls like this, but today you must not tell a soul.", "secrecy_isolation"),
    Case("adv5", "suspicious", "Never share your OTP with anyone except me, so read me the OTP now.", "credential_request"),
)
