/* Question types the judge mixes, plus a built-in bank for offline practice (no AI judge connected). */
(function (root) {
  const TYPES = {
    market: { label: 'Market size', tip: 'Give a number, show how you got it, and keep it believable.' },
    competition: { label: 'Competition', tip: 'Name real competitors and the one thing you do that they can’t.' },
    model: { label: 'Business model', tip: 'Who pays, how much, how often.' },
    unit: { label: 'Unit economics', tip: 'Cost to win a customer vs. what they’re worth over time.' },
    gtm: { label: 'Go-to-market', tip: 'Your first 10 customers: who, how you reach them, how fast.' },
    traction: { label: 'Traction', tip: 'Lead with your strongest real proof, even if it’s small.' },
    customer: { label: 'Customer proof', tip: 'Quote a real customer or a real number from a pilot.' },
    product: { label: 'Product', tip: 'Walk through it like a demo in 3 steps.' },
    moat: { label: 'Defensibility', tip: 'What gets stronger the more customers you have?' },
    regulation: { label: 'Regulation & privacy', tip: 'Show you know the rules (HIPAA, payer rules) and have a plan.' },
    team: { label: 'Team', tip: 'Why you specifically win this, in one story.' },
    whynow: { label: 'Why now', tip: 'What changed recently that makes this possible or urgent.' },
    funds: { label: 'Use of funds', tip: 'Amount, what it buys, and the milestone it gets you to.' },
    valuation: { label: 'Valuation', tip: 'Stay calm, anchor on milestones, don’t get defensive.' },
    risk: { label: 'Biggest risk', tip: 'Name a real risk and how you’re reducing it. Honesty scores.' },
    exit: { label: 'Exit', tip: 'Name likely acquirers and why they’d buy.' },
    curveball: { label: 'Curveball', tip: 'Pause, take a breath, answer the real question underneath.' },
    pushback: { label: 'Pushback', tip: 'Agree with what’s true, then hold your ground with evidence.' },
    lightning: { label: 'Lightning round', tip: 'One sentence. No warm-up.' },
    founder: { label: 'Founder story', tip: 'Short, personal, ties back to the problem.' }
  };

  const BANK = {
    market: ['How big is this market, and how did you get that number?', 'How many dental offices could realistically buy this in the next three years?'],
    competition: ['Dentrix and Open Dental already handle claims. Why would an office switch to you?', 'Who else is trying to solve this, and why haven’t they won yet?'],
    model: ['Who actually pays you, the office or the patient, and how much?', 'Is this a subscription, a per-claim fee, or a cut of recovered money? Why that one?'],
    unit: ['What does it cost you to sign one dental office, and what is that office worth to you over three years?', 'How long until a new customer pays back what it cost to win them?'],
    gtm: ['How do you get your first ten paying offices?', 'Office managers are swamped. How do you even get their attention?'],
    traction: ['What proof do you have that anyone wants this?', 'What has happened in your pilot so far, in numbers?'],
    customer: ['Tell me about one office manager who said they’d pay for this. What exactly did they say?', 'What would make a dentist cancel after the first month?'],
    product: ['Walk me through what happens the moment a claim gets submitted.', 'What does the patient actually see on their phone?'],
    moat: ['If this works, what stops a big billing company from copying it in six months?', 'What gets better about your product as you add more offices?'],
    regulation: ['You’re touching patient health and insurance data. How do you handle HIPAA?', 'What happens if your tool tells a patient the wrong price?'],
    team: ['Why are you the right person to build this, as a student with no dental background?', 'Who is on your team, and what is missing?'],
    whynow: ['Dental billing has been painful for decades. Why is now the moment?', 'What changed in the last two years that makes this possible?'],
    funds: ['How much are you raising, and what exactly does it get you to?', 'If I gave you half of what you’re asking for, what would you cut?'],
    valuation: ['What valuation are you raising at, and why is that fair?', 'Why should I invest now instead of waiting six months to see traction?'],
    risk: ['What is the single biggest reason this company dies?', 'What are you assuming that might turn out to be wrong?'],
    exit: ['Who buys this company in five years, and why?', 'How do I, as an investor, make ten times my money?'],
    curveball: ['If you couldn’t use software at all, how would you solve this problem?', 'What is something about dental offices most people get wrong?'],
    pushback: ['Honestly, this sounds like a feature, not a company. Convince me I’m wrong.', 'I’ve heard three healthcare billing pitches this month. Why should I remember yours?'],
    lightning: ['In one sentence, what do you do?', 'One sentence: why will you win?'],
    founder: ['Why do you personally care about this problem?', 'Tell me about a time you got knocked down and how you responded.']
  };

  function offlineQuestions(n) {
    const order = ['lightning', 'traction', 'competition', 'model', 'gtm', 'pushback', 'market', 'regulation', 'unit', 'team', 'risk', 'funds', 'moat', 'curveball', 'whynow', 'customer', 'product', 'valuation', 'exit', 'founder'];
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const types = order.slice(0, Math.max(n, 3));
    // shuffle the middle so sessions differ, keep the one-liner first
    for (let i = types.length - 1; i > 1; i--) { const j = 1 + Math.floor(Math.random() * i); [types[i], types[j]] = [types[j], types[i]]; }
    return types.slice(0, n).map(t => ({ type: t, q: pick(BANK[t]) }));
  }

  root.Questions = { TYPES, BANK, offlineQuestions };
  if (typeof module !== 'undefined') module.exports = root.Questions;
})(typeof window !== 'undefined' ? window : globalThis);
