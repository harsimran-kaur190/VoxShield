"""Labeled scam-intent transcripts for comparing detectors.

ORIGIN: every example was written by hand (by the AI assistant that built VoxShield) in the style of Whisper
transcripts. They are synthetic. They are NOT recordings or transcripts of real calls, so results on them say nothing
reliable about real-world accuracy.

LABELS
  scam        True when the speaker directly attempts a scam: asks the listener for a secret code or credentials,
              pressures a payment or transfer, demands remote access, or discourages verification. Legitimate
              urgent calls, benign money talk, warnings, hypotheticals, and recounted scams are False.
  categories  Behaviors that the speaker directly performs in the text, whether or not the call is legitimate
              (e.g. a roommate asking for their share of the rent is `payment_pressure`, with scam=False).
              C credential_request, P payment_pressure, I impersonation, T coercion_threat, U urgency,
              S secrecy_isolation, V verification_bypass, R remote_access.

SPLITS
  dev   used to choose thresholds and refine the model's statements.
  test  held out: never looked at while tuning. Written with different wording from dev for every scenario.
"""

from dataclasses import dataclass

CATEGORY_CODES = {
    "C": "credential_request",
    "P": "payment_pressure",
    "I": "impersonation",
    "T": "coercion_threat",
    "U": "urgency",
    "S": "secrecy_isolation",
    "V": "verification_bypass",
    "R": "remote_access",
}


@dataclass(frozen=True)
class Example:
    id: str
    split: str
    kind: str
    scam: bool
    categories: frozenset[str]
    text: str


# (kind, scam, category codes, text)
_DEV = [
    # urgent fraudulent payment requests
    ("urgent_payment", True, "ITPU", "Sir, this is the tax department. You owe four thousand dollars in back taxes and a warrant will be issued today. You must go to the store, buy gift cards, and read me the numbers right now."),
    ("urgent_payment", True, "PU", "Your grandson was in an accident and needs bail money immediately. Please wire three thousand dollars to this account before the end of the day or he will stay in jail."),
    ("urgent_payment", True, "PU", "We have found suspicious charges on your card. To protect your funds, transfer your balance to the safe account I am about to give you. This has to happen in the next ten minutes."),
    ("urgent_payment", True, "PUT", "Hello, I'm calling about your electricity bill. It is overdue and your power will be cut off in thirty minutes unless you pay two hundred dollars by bitcoin right now."),
    ("urgent_payment", True, "PUT", "This is an urgent message. Pay the customs fee of five hundred euros today with a prepaid voucher or your package will be destroyed and legal action will follow."),
    # OTP and credential requests
    ("otp_credentials", True, "IC", "Hi, I'm from your bank's security team. We just sent a six digit code to your phone. Can you read it back to me so I can cancel the fraudulent transfer?"),
    ("otp_credentials", True, "C", "To verify your identity I need your card number, the expiry date, and the three digits on the back. Please give them to me now."),
    ("otp_credentials", True, "C", "There is a problem with your account login. Tell me your password and the code that was just texted to you and I will fix it from my side."),
    ("otp_credentials", True, "C", "Sir, for security purposes please confirm your net banking user ID and your pin number, then I will unblock your account."),
    ("otp_credentials", True, "C", "I am sending you a verification code. When it arrives, just say the numbers out loud to me and we will be done in a minute."),
    # verification bypass
    ("verification_bypass", True, "VI", "You don't need to call the bank, I am the bank. Calling them will only delay things and your money will be gone, so just follow my instructions."),
    ("verification_bypass", True, "VU", "Please do not hang up and do not visit your local branch. The branch staff are part of the investigation. Stay on the line with me."),
    ("verification_bypass", True, "VPU", "There is no point in verifying this with anyone else. Just transfer the funds to the secure account now and I will send you the confirmation later."),
    ("verification_bypass", True, "V", "Don't look up the number online, it is a fake. Only trust the number I'm giving you."),
    ("verification_bypass", True, "VSI", "If you check with your family they will only confuse you. This is a federal matter, so handle it yourself."),
    # secrecy and impersonation
    ("secrecy_impersonation", True, "IST", "This is Detective Ramirez from the cyber crime unit. Your identity has been used in a crime. This investigation is confidential, so you must not discuss it with anyone, not even your wife."),
    ("secrecy_impersonation", True, "IS", "I'm calling from Microsoft support. Your computer is sending out errors. Please keep this between us, our manager has not approved this service."),
    ("secrecy_impersonation", True, "IS", "Hello dear, it's your nephew. I'm in a bit of trouble and I need your help, but please don't tell my mom. I'll explain later."),
    ("secrecy_impersonation", True, "IST", "Madam, we are from the income tax office. A case has been filed in your name. Do not inform your relatives or neighbours or it will become a public matter."),
    ("secrecy_impersonation", True, "IS", "Congratulations, you've won a prize from the national lottery. To claim it, don't tell anyone until the money reaches you, otherwise the prize will be cancelled."),
    # remote access
    ("remote_access", True, "R", "Please open your browser and download AnyDesk. Then tell me the nine digit number on the screen so I can connect to your computer and remove the virus."),
    ("remote_access", True, "R", "I need you to install this app on your phone so I can see your screen and help you cancel the payment."),
    ("remote_access", True, "R", "Go to this website and install the support tool, then give me access to your desktop so my technician can fix your account."),
    ("remote_access", True, "R", "We will refund the amount, but first allow me to control your computer. Click the link I sent and press allow."),
    # family emergency
    ("family_emergency", True, "IPUS", "Grandma, it's me. I got arrested after a car accident and I need you to send money for the lawyer right now, please don't tell Dad."),
    ("family_emergency", True, "IPU", "Mom, I lost my phone and I'm using a friend's. I need you to transfer some money to this account today, it's really urgent."),
    ("family_emergency", True, "IPS", "Hi Grandpa, can you guess who this is? I'm in the hospital and I need cash. Please, it has to stay between us."),
    ("family_emergency", True, "IPUS", "Auntie, it's me. My wallet got stolen abroad and I'm stuck. Can you send me money on this number immediately? Please don't tell anyone yet."),
    # benign financial conversations
    ("benign_financial", False, "", "I called the bank this morning to ask about the interest rate on the savings account, and they said it changes every quarter, so I'll check again in April."),
    ("benign_financial", False, "P", "Can you send me the money for the concert tickets by Friday? I already paid for all of them with my card and I'm splitting the total."),
    ("benign_financial", False, "", "My mortgage payment goes out on the first of every month, and I set up the automatic transfer last year, so I don't have to think about it."),
    ("benign_financial", False, "", "The bank texted me a one time code when I logged in on my new laptop, I typed it in the app and everything worked fine."),
    ("benign_financial", False, "", "I need to wire the deposit for the apartment, so the agent emailed me the account details and I'm going to confirm them with the landlord by phone first."),
    ("benign_financial", False, "", "Thanks for calling Northside Credit Union. Your card ending in 4421 has been shipped and should arrive within seven business days. There is nothing you need to do."),
    ("benign_financial", False, "P", "We're going to need to split the electricity bill three ways this month, so each of us owes about sixty dollars, I'll send you the breakdown tonight."),
    # legitimate urgent situations
    ("legit_urgent", False, "", "Hello, this is the pharmacy. Your prescription is ready, and it needs to be picked up by six today, otherwise we have to return it to stock."),
    ("legit_urgent", False, "U", "Please come to the hospital as soon as you can, your father fell and the doctors want to talk to the family. Drive carefully, there is no need to rush into anything."),
    ("legit_urgent", False, "U", "This is the school office. There's been a gas leak, and we are asking all parents to pick up their children immediately from the east gate."),
    ("legit_urgent", False, "U", "Your card was just used for a purchase of nine hundred dollars at an electronics store. If this wasn't you, press one now and we will block the card. We will never ask for your pin or password."),
    ("legit_urgent", False, "U", "The fire department is on the way. Please leave the building now and meet at the car park, do not use the elevators."),
    ("legit_urgent", False, "U", "Your flight has been moved forward by two hours, so please get to the airport as soon as you can and bring your passport to the transfer desk."),
    # negated
    ("negated", False, "", "Remember that we will never call you to ask for your password or your one time code, so if anyone does, hang up and report it to us."),
    ("negated", False, "", "Our staff will never ask you to transfer money to a safe account, and you should never share your pin with anyone, including us."),
    ("negated", False, "", "Don't worry, there's no rush. Take your time, and you can always call the number on the back of your card to double check before you decide anything."),
    ("negated", False, "", "I'm not asking you to send any money. I just wanted to let you know that the fundraiser is on Saturday if you feel like coming."),
    ("negated", False, "", "Please do not give your card details to anyone who calls you unexpectedly, even if they say they're from the bank."),
    ("negated", False, "", "You do not need to install anything or give anybody access to your computer. The update will happen on its own overnight."),
    # hypothetical
    ("hypothetical", False, "", "Imagine someone phones you and says they're from the tax office and tells you to buy gift cards. What would you do? That is exactly the kind of scenario we practise in this workshop."),
    ("hypothetical", False, "", "If a caller ever asks you for the code on your phone, that's a red flag, so what you do is you hang up and call the bank back."),
    ("hypothetical", False, "", "Suppose I told you to wire me ten thousand dollars and not to tell your wife, would you do it? Of course not, that would be absurd, I'm just making a point about trust."),
    ("hypothetical", False, "", "In the training video the actor pretends to be a bank officer and asks for an OTP, and then the narrator explains why that's suspicious."),
    ("hypothetical", False, "", "Let's say you get an email saying your account will be closed in an hour, how would you check if it's real before you click anything?"),
    # quoted or recounted
    ("quoted_recounted", False, "", "My uncle got a call yesterday where the guy said he was from the police and that he had to pay a fine with gift cards, and my uncle just laughed and hung up."),
    ("quoted_recounted", False, "", "She told me the caller said, don't tell your children about this. That's when she realised it was a scam and phoned me."),
    ("quoted_recounted", False, "", "The text message literally says, send your bank pin to this number within the hour, and I reported it as spam straight away."),
    ("quoted_recounted", False, "", "They asked my neighbour for his one time password, and he gave it away, so now he is on the phone with the bank trying to sort it out."),
    ("quoted_recounted", False, "", "On the news this morning they said scammers are telling people to install remote access software and then emptying their accounts."),
    ("quoted_recounted", False, "", "The voicemail said, this is your final notice, call us immediately, and of course I didn't, because it was obviously a robocall."),
    ("quoted_recounted", False, "", "When my dad called me pretending to be in jail, the voice was so convincing, but I asked him a question only he would know and the caller hung up."),
    # transcription errors
    ("transcription_errors", True, "IC", "Hi this is from the bank sicurity team we detected a fraud on you account please read me the cod we just send to you fone"),
    ("transcription_errors", True, "PUT", "you must pay the amunt immediatly in git cards or we will arest you today"),
    ("transcription_errors", True, "SPU", "do not tell any one about this and trasfer the money to the acount i gave you rite now"),
    ("transcription_errors", False, "", "uh the bank said we can um come in on thursday to uh sign the loan papers and bring our i d"),
    ("transcription_errors", False, "", "so thanks for the tranfer of fifty pounds i got it this morning no problem at all and see you saturday"),
    ("transcription_errors", False, "", "hello hello can you hear me the line is breaking up i will call you back in five minutes"),
    # incomplete speech
    ("incomplete", True, "C", "Read me the code you just got."),
    ("incomplete", True, "SP", "Don't tell anyone, just send the money."),
    ("incomplete", False, "", "Hello? Hi, it's me, can you hear me"),
    ("incomplete", False, "", "Yeah, I'll send it over"),
    ("incomplete", False, "", "Okay, the card is blocked and"),
    # ordinary conversation
    ("benign_everyday", False, "", "Hey, are we still on for dinner at seven? I booked the table for four, and Anna said she might be late because of the train."),
    ("benign_everyday", False, "", "The meeting has moved to Thursday afternoon, so please update your calendar and send me the slides before then."),
    ("benign_everyday", False, "", "My phone bill went up again this month, I really need to look at switching providers before the contract renews."),
    ("benign_everyday", False, "", "Can you grab some milk on the way home? And if you pass the post office, I'm expecting a parcel."),
    ("benign_everyday", False, "", "The doctor said the results look fine and I should come back in six months for a check-up, so I made the appointment for November."),
]

_TEST = [
    # urgent fraudulent payment requests
    ("urgent_payment", True, "ITPU", "Good afternoon, this is the Social Security Administration. Your number has been suspended due to illegal activity. To reactivate it you will have to purchase prepaid cards worth one thousand dollars and give us the codes before five o'clock."),
    ("urgent_payment", True, "PU", "Ma'am your son has been in a serious road accident and the hospital will not operate until the deposit is paid. Send eight thousand rupees to this UPI id this minute."),
    ("urgent_payment", True, "PU", "We are processing a refund but you accidentally received too much. Please send the extra eleven hundred dollars back through a money transfer service today so we can close the file."),
    ("urgent_payment", True, "PU", "Your streaming subscription will renew at three hundred ninety nine dollars. To cancel, buy a gift card and tell the agent the number, otherwise the amount will be deducted tonight."),
    ("urgent_payment", True, "ITPU", "This is final warning from the courthouse. A summons has been issued and you can avoid arrest only by paying the bail amount in crypto within the hour. Do you understand?"),
    ("urgent_payment", True, "PUT", "Our system flagged your account, move your savings to the protected wallet number I am about to read out or the funds will be frozen within the hour."),
    ("urgent_payment", True, "PUT", "Hello sir, I am calling about the car accident you were involved in. The other party is going to sue unless you settle right now by wire. I can take your payment details over the phone."),
    # OTP and credential requests
    ("otp_credentials", True, "C", "We've blocked a suspicious login to your email. Please tell me the verification number that appeared on your phone so that I can restore access."),
    ("otp_credentials", True, "C", "For your safety, please provide the sixteen digit number on your debit card and your date of birth so that we can reissue it."),
    ("otp_credentials", True, "C", "Sir, an unknown device is trying to use your account. I will cancel it, but first I need the secret answer and the OTP you just received."),
    ("otp_credentials", True, "IC", "Hi, this is Amazon customer care, we are refunding your order. Please open the app and read me the code that you see on the confirmation page."),
    ("otp_credentials", True, "IC", "Your account will be unlocked once you tell me your internet banking password. I am a bank employee, so you can trust me with it."),
    ("otp_credentials", True, "CU", "Please check your messages, you should have received a pin from us, and I need you to say it to me now so I can approve your claim."),
    ("otp_credentials", True, "C", "Dear customer, to complete your KYC update please share your Aadhaar number and the one time password sent to your registered mobile."),
    # verification bypass
    ("verification_bypass", True, "VC", "There's no need to go through the app or call customer service, that process takes days. Give me your details and I'll sort this out right here."),
    ("verification_bypass", True, "V", "Whatever you do, don't contact your bank about this call. They will only block the transfer and then we can't protect you."),
    ("verification_bypass", True, "VUTS", "I understand you want to call back, but if you hang up now the case will be closed against you. So please stay with me and don't check with anyone."),
    ("verification_bypass", True, "VS", "You shouldn't talk to the bank manager or the police about this, they are not cleared for this operation."),
    ("verification_bypass", True, "V", "Please don't google our company or look for reviews, the internet is full of lies from people who want to harm our reputation."),
    ("verification_bypass", True, "VP", "Just skip the usual verification step this time, I've already confirmed your identity on my end, so go ahead and approve the payment."),
    # secrecy and impersonation
    ("secrecy_impersonation", True, "IST", "This is Officer Daniels. A drug parcel was intercepted with your name on it. The case is sealed, and you are legally prohibited from speaking about it to any person."),
    ("secrecy_impersonation", True, "IPS", "Hi, it's your boss. I'm in a meeting and I need you to buy some gift cards for a client. Keep it quiet for now, I'll reimburse you later."),
    ("secrecy_impersonation", True, "ST", "Please remember this call is strictly confidential, if your colleagues find out that you spoke to us, the matter will become much worse for you."),
    ("secrecy_impersonation", True, "ISV", "I'm from the bank's investigation team. Someone inside the branch is stealing from customers, so you can't mention our conversation to any of the staff."),
    ("secrecy_impersonation", True, "ISCP", "It's Sarah from your son's school. Something has come up and I need you to keep this just between us for the moment. Can I get your card number to cover the fee?"),
    ("secrecy_impersonation", True, "IST", "We are calling on behalf of the immigration department. Your visa has a problem, and unless you keep this private and cooperate, you could be deported."),
    # remote access
    ("remote_access", True, "R", "Press the Windows key and R, then type the address I'm about to give you, it will download a small program that lets me fix your internet from here."),
    ("remote_access", True, "R", "Install the QuickSupport app from the store and give me the session number, my engineer will then see your phone."),
    ("remote_access", True, "R", "Let me log into your computer remotely, it takes two minutes. All you have to do is accept the connection request when it pops up."),
    ("remote_access", True, "RC", "Your router has been hacked. Please install TeamViewer, and read me the ID and password it shows so we can secure everything."),
    ("remote_access", True, "R", "Share your screen with me so I can watch you open the banking app, I'll guide you through cancelling the transfer."),
    # family emergency
    ("family_emergency", True, "IPTS", "Hello Nana, it's Jake. I'm in big trouble, I crashed a rental car and I need two thousand dollars for the repair or they're pressing charges. Please don't call my parents."),
    ("family_emergency", True, "IPU", "Dad? I dropped my phone in the lake, this is a new number. Can you transfer some money to my friend? It's urgent, I'll explain tonight."),
    ("family_emergency", True, "IPU", "Hi Aunt, it's your niece, I'm at the airport and my card got declined. Can you please send me three hundred right away? I'll pay you back."),
    ("family_emergency", True, "IPS", "Grandpa it's me, I'm at the police station, they won't let me call anyone else. Please come up with the bail money and keep this secret from Mom."),
    ("family_emergency", True, "IPVT", "Uncle, I've been kidnapped, please send the ransom to this account, and do not call the police or they will hurt me."),
    # benign financial conversations
    ("benign_financial", False, "", "I checked my credit card statement and there's a charge from the gym that I forgot to cancel, so I'm going to phone them tomorrow and ask for a refund."),
    ("benign_financial", False, "P", "Could you transfer your half of the holiday cottage to my account sometime this week? Here's the sort code, and no hurry."),
    ("benign_financial", False, "", "The loan officer explained the rates, and then he told me to bring my payslips and my ID to the branch on Monday morning."),
    ("benign_financial", False, "", "I got a notification that my one time passcode was used to approve a payment, and it was me, I was buying a train ticket."),
    ("benign_financial", False, "", "We should open a joint account to cover the household bills, I'll ask the bank which one has the lowest fees and send you the details."),
    ("benign_financial", False, "", "Thank you for your payment of two hundred dollars, which we received on the third, your balance is now zero and no further action is required."),
    ("benign_financial", False, "P", "Please remember to pay the invoice by the end of the month, the details are on the second page, and call me if anything is unclear."),
    ("benign_financial", False, "", "My sister asked me to lend her some money for the deposit and I said yes, I'll bring a cheque when we meet on Sunday."),
    # legitimate urgent situations
    ("legit_urgent", False, "U", "Mr Patel? This is the vet clinic. Your dog swallowed something, and the doctor says you need to bring him in right away."),
    ("legit_urgent", False, "U", "Security alert from your bank. We noticed a login from a new country. If it wasn't you, please call the number printed on your card straight away. We won't ask for any codes."),
    ("legit_urgent", False, "U", "This is the electric company. A storm has damaged the lines on your street, so we are asking customers to stay away from the poles and report any fallen wires immediately."),
    ("legit_urgent", False, "U", "Please hurry to the clinic, your wife is in labour and she's asking for you, the nurses said everything is fine but you should come now."),
    ("legit_urgent", False, "U", "Hello, it's the building manager, there's a pipe burst on the fourth floor, can you come home right now and turn off the water at the main valve?"),
    ("legit_urgent", False, "", "Your appointment is in thirty minutes, so please arrive ten minutes early to fill out the paperwork."),
    ("legit_urgent", False, "U", "The school bus broke down and the kids are safe at the garage, but we need a parent to pick them up as soon as possible."),
    # negated
    ("negated", False, "", "Under no circumstances will our representatives ask for your PIN, so never read it out to anyone on the phone, however official they sound."),
    ("negated", False, "", "I am not going to ask you for any money, and I'm definitely not going to pressure you into anything, I just want to explain the options."),
    ("negated", False, "", "You don't have to decide today, and nobody is going to hurry you, so take the brochure home and think about it with your family."),
    ("negated", False, "", "Please don't download anything a stranger sends you and never let a caller take control of your computer."),
    ("negated", False, "", "It is not true that you must pay anything to claim the refund, so if someone tells you that, it's a scam."),
    ("negated", False, "", "We would never tell you to keep a transaction secret from your family, so do talk to them before signing anything."),
    ("negated", False, "", "I don't need your password, I only need you to confirm that the address on file is still correct."),
    # hypothetical
    ("hypothetical", False, "", "What if a man rings your doorbell and says he's from the gas company and that he needs to come in right now? The advice is to ask for ID and call the company."),
    ("hypothetical", False, "", "In this exercise, one of you plays the scammer and says, give me your bank code, and the other has to say no and end the call."),
    ("hypothetical", False, "", "Would you transfer money to a stranger who said your son was in danger? Most people think no, but panic changes things, which is why we rehearse."),
    ("hypothetical", False, "", "Say a message pops up claiming your PC is infected and tells you to call a number and let them connect, you should close it and run your own scan."),
    ("hypothetical", False, "", "If somebody ever tells you to keep a secret from your bank, treat that as the biggest warning sign of all."),
    ("hypothetical", False, "", "Let's assume the caller demands an immediate payment by gift cards, the correct response is to refuse and report the number."),
    # quoted or recounted
    ("quoted_recounted", False, "", "My friend said the woman on the phone kept repeating, you must pay now or you'll be arrested, and she was shaking by the time she called me."),
    ("quoted_recounted", False, "", "He told the police that the man asked him to read out the six digit code, which is how they got into his account."),
    ("quoted_recounted", False, "", "The email my colleague forwarded says, please confirm your password within the hour, and obviously we've blocked the sender."),
    ("quoted_recounted", False, "", "The scammer told her not to tell her husband, but she did anyway, and that's how they stopped it in time."),
    ("quoted_recounted", False, "", "I played the recording for the class, in it the caller says this is the bank, and you need to move your money to a safe account, and then we discuss why that's a lie."),
    ("quoted_recounted", False, "", "My mum got a voicemail saying her account was frozen and that she had to call back immediately, but she phoned the bank instead and it was all fine."),
    ("quoted_recounted", False, "", "In the article, the victim describes how the fake officer asked for gift cards and told her to stay on the line the entire time."),
    ("quoted_recounted", False, "", "They tried the old grandson trick on my neighbour, the caller cried and said he needed bail money, but she hung up and called her real grandson."),
    # transcription errors
    ("transcription_errors", True, "ITPU", "this is the polis department you have a warant send the money by git card now or you will be arested"),
    ("transcription_errors", True, "C", "plese tell me the otp you recieved on you mobile so i can unblock you acount"),
    ("transcription_errors", True, "SPU", "dont tel your family and send us the paymnt in bit coin before tonite"),
    ("transcription_errors", False, "", "yeah so the bank is gonna send me a new card in the post and uh i have to activate it when it comes"),
    ("transcription_errors", False, "", "can you send me the adress for the party and also what time should i come um thanks"),
    ("transcription_errors", False, "", "sorry the line is bad i can barely her you can you repeat that"),
    ("transcription_errors", False, "", "she sayd the polis called about the car but it was just parking ticket nothing serious"),
    # incomplete speech
    ("incomplete", True, "C", "Give me your pin number."),
    ("incomplete", True, "R", "Install this and let me in."),
    ("incomplete", True, "PTU", "Pay now or you're arrested."),
    ("incomplete", False, "", "Hello, can I speak to Mr Brown?"),
    ("incomplete", False, "", "I just wanted to say that the"),
    ("incomplete", False, "", "Right, so the thing is we need to"),
    ("incomplete", False, "", "Okay thanks, bye bye."),
    # ordinary conversation
    ("benign_everyday", False, "", "Did you see the match last night? I couldn't believe the referee, it was a clear foul and he didn't even blow the whistle."),
    ("benign_everyday", False, "", "I'll pick up the kids from football at five and then we can all have pizza, if that works for you."),
    ("benign_everyday", False, "", "The plumber is coming at nine tomorrow, so someone needs to be home, can you make it or should I ask the neighbour?"),
    ("benign_everyday", False, "", "Thanks for sending over the contract, I've read it and I have two small questions about the delivery dates."),
    ("benign_everyday", False, "", "Mum wants to know whether you're coming for Sunday lunch, she's making the roast potatoes you like."),
    ("benign_everyday", False, "", "Our flight leaves at seven, so let's leave the house at four and have a proper breakfast at the airport."),
    ("benign_everyday", False, "", "The new phone arrived today, I haven't set it up yet but the battery seems to last much longer than the old one."),
]


def _build(split: str, rows: list[tuple[str, bool, str, str]]) -> list[Example]:
    return [
        Example(f"{split}-{i + 1:03d}", split, kind, scam, frozenset(CATEGORY_CODES[c] for c in codes), text)
        for i, (kind, scam, codes, text) in enumerate(rows)
    ]


DEV = _build("dev", _DEV)
TEST = _build("test", _TEST)


def _tokens(text: str) -> list[str]:
    return "".join(c.lower() if c.isalnum() or c.isspace() else " " for c in text).split()


def _trigrams(text: str) -> set[tuple[str, ...]]:
    words = _tokens(text)
    return {tuple(words[i : i + 3]) for i in range(max(1, len(words) - 2))}


def check_split_overlap(threshold: float = 0.4) -> list[tuple[str, str, float]]:
    """Pairs (test id, dev id, similarity) that are exact duplicates or share too many word trigrams."""
    problems = []
    dev_grams = {e.id: (e.text.strip().lower(), _trigrams(e.text)) for e in DEV}
    for t in TEST:
        t_text, t_grams = t.text.strip().lower(), _trigrams(t.text)
        for dev_id, (d_text, d_grams) in dev_grams.items():
            union = len(t_grams | d_grams) or 1
            similarity = len(t_grams & d_grams) / union
            if t_text == d_text or similarity >= threshold:
                problems.append((t.id, dev_id, round(similarity, 2)))
    return problems


def check_within_split_duplicates(examples: list[Example]) -> list[tuple[str, str]]:
    seen: dict[str, str] = {}
    duplicates = []
    for e in examples:
        key = " ".join(_tokens(e.text))
        if key in seen:
            duplicates.append((seen[key], e.id))
        seen[key] = e.id
    return duplicates
