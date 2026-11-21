/* Delivery analysis: everything about HOW you said it, not what you said.
   Input: 16 kHz mono Float32Array audio, Whisper word chunks, optional emotion scores.
   Plain JS so it runs in the browser and in Node tests. */
(function (root) {
  const SR = 16000, HOP = 320, WIN = 640; // 20 ms hop, 40 ms window
  const HOP_S = HOP / SR;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)]; };
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

  // ---------- frame-level loudness and pitch ----------
  function frames(audio) {
    const n = Math.max(0, Math.floor((audio.length - WIN) / HOP) + 1);
    const db = new Float32Array(n), f0 = new Float32Array(n);
    // 8 kHz copy for cheaper pitch tracking
    const ds = new Float32Array(audio.length >> 1);
    for (let i = 0; i < ds.length; i++) ds[i] = 0.5 * (audio[2 * i] + audio[2 * i + 1]);
    const W2 = WIN >> 1, minLag = 20, maxLag = 107; // 75–400 Hz at 8 kHz
    for (let f = 0; f < n; f++) {
      const o = f * HOP;
      let e = 0;
      for (let i = 0; i < WIN; i++) e += audio[o + i] * audio[o + i];
      const rms = Math.sqrt(e / WIN);
      db[f] = 20 * Math.log10(rms + 1e-9);
      const o2 = o >> 1;
      if (o2 + W2 + maxLag >= ds.length) continue;
      let e0 = 0;
      for (let i = 0; i < W2; i++) e0 += ds[o2 + i] * ds[o2 + i];
      if (e0 < 1e-7) continue;
      let best = 0, bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0, el = 0;
        for (let i = 0; i < W2; i++) { const b = ds[o2 + i + lag]; c += ds[o2 + i] * b; el += b * b; }
        const r = c / Math.sqrt(e0 * el + 1e-12);
        if (r > best) { best = r; bestLag = lag; }
      }
      if (best > 0.55 && bestLag) {
        // parabolic refinement is overkill here; integer lag is fine for semitone stats
        f0[f] = 8000 / bestLag;
      }
    }
    return { db, f0, n };
  }

  // ---------- voice activity (speech vs silence) ----------
  function vad(db) {
    const arr = Array.from(db);
    const floor = pct(arr, 0.1), peak = pct(arr, 0.95);
    const thr = Math.max(floor + 0.3 * (peak - floor), floor + 6);
    const sp = new Uint8Array(db.length);
    for (let i = 0; i < db.length; i++) sp[i] = db[i] > thr ? 1 : 0;
    // fill short gaps (< 200 ms) inside speech
    const fill = Math.round(0.2 / HOP_S);
    let i = 0;
    while (i < sp.length) {
      if (sp[i]) { i++; continue; }
      let j = i; while (j < sp.length && !sp[j]) j++;
      if (i > 0 && j < sp.length && j - i < fill) sp.fill(1, i, j);
      i = j;
    }
    // drop blips (< 80 ms)
    const segs = [];
    i = 0;
    while (i < sp.length) {
      if (!sp[i]) { i++; continue; }
      let j = i; while (j < sp.length && sp[j]) j++;
      if ((j - i) * HOP_S < 0.08) sp.fill(0, i, j); else segs.push([i * HOP_S, j * HOP_S]);
      i = j;
    }
    return { sp, segs, thr, floor, peak };
  }

  // ---------- words, fillers, hedges ----------
  const FILLERS = ['um', 'uh', 'umm', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm'];
  const FILLER_PHRASES = ['you know', 'i mean', 'kind of', 'sort of', 'basically', 'literally'];
  const HEDGES = ['i think', 'i guess', 'maybe', 'probably', 'hopefully', 'i feel like', 'i believe', 'we hope', 'try to', 'trying to', 'kinda', 'sorta', 'not sure', 'we think', 'i hope'];

  function normWords(chunks) {
    // Whisper sometimes splits "$20,000" into "$20" + ",000": glue those back together
    const merged = [];
    for (const c of (chunks || [])) {
      if (!c || !c.text || !c.timestamp) continue;
      const t = c.text.trim();
      if (merged.length && /^[,.%'][0-9a-z%]/i.test(t)) { const p = merged[merged.length - 1]; p.text = p.text.trimEnd() + t; p.timestamp = [p.timestamp[0], c.timestamp[1] ?? p.timestamp[1]]; continue; }
      merged.push({ text: c.text, timestamp: [...c.timestamp] });
    }
    let last = 0;
    return merged.map(c => {
      const raw = c.text.trim();
      const s = c.timestamp[0] ?? last, e = c.timestamp[1] ?? s + 0.3;
      last = Math.max(last, e);
      return { raw, w: raw.toLowerCase().replace(/[^a-z0-9'$%]/g, ''), start: s, end: Math.max(e, s + 0.05), endsSentence: /[.!?]["')]*$/.test(raw), question: /\?["')]*$/.test(raw), comma: /,$/.test(raw) };
    }).filter(x => x.w || x.raw);
  }

  function tagWords(words) {
    const tags = words.map(() => null);
    const lw = words.map(x => x.w);
    words.forEach((x, i) => { if (FILLERS.includes(x.w)) tags[i] = 'filler'; });
    // "like" used as filler: next to a comma, or sentence start
    words.forEach((x, i) => {
      if (x.w !== 'like' || tags[i]) return;
      const prev = words[i - 1];
      if (x.comma || (prev && (prev.comma || prev.endsSentence)) || i === 0) tags[i] = 'filler';
    });
    const phrase = (list, tag) => {
      for (const p of list) {
        const parts = p.split(' ');
        for (let i = 0; i + parts.length <= lw.length; i++) {
          if (parts.every((q, k) => lw[i + k] === q) && parts.every((q, k) => !tags[i + k])) for (let k = 0; k < parts.length; k++) tags[i + k] = tag;
        }
      }
    };
    phrase(FILLER_PHRASES, 'filler');
    phrase(HEDGES, 'hedge');
    let fillers = 0, hedges = 0;
    const found = { filler: [], hedge: [] };
    for (let i = 0; i < tags.length; i++) {
      if (!tags[i] || tags[i] === tags[i - 1]) continue;
      let j = i, ph = [];
      while (j < tags.length && tags[j] === tags[i]) ph.push(lw[j++]);
      found[tags[i]].push(ph.join(' '));
    }
    // adjacent tagged words of the same kind count as one occurrence ("kind of" = 1)
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] && tags[i] !== tags[i - 1]) { if (tags[i] === 'filler') fillers++; else hedges++; }
    }
    return { tags, fillers, hedges, found };
  }

  // ---------- scoring helpers ----------
  function grade(score) { return score >= 8 ? 'good' : score >= 5.5 ? 'ok' : 'fix'; }

  function analyze(audio, chunks, opts = {}) {
    const dur = audio.length / SR;
    const { db, f0, n } = frames(audio);
    const { sp, segs } = vad(db);
    const words = normWords(chunks);
    const { tags, fillers, hedges, found } = tagWords(words);
    const spokenWords = words.filter((_, i) => tags[i] !== 'filler').length;

    const firstSpeech = segs.length ? segs[0][0] : (words[0] ? words[0].start : 0);
    const lastSpeech = segs.length ? segs[segs.length - 1][1] : (words.length ? words[words.length - 1].end : dur);
    const span = Math.max(1, lastSpeech - firstSpeech);
    const minutes = span / 60;
    const speechTime = segs.reduce((s, g) => s + g[1] - g[0], 0);

    // pace
    const wpm = spokenWords / minutes;
    const windows = [];
    for (let t = firstSpeech; t + 10 <= lastSpeech; t += 10) {
      const c = words.filter(x => x.start >= t && x.start < t + 10 && FILLERS.indexOf(x.w) < 0).length;
      windows.push(c * 6);
    }
    const paceSwing = windows.length > 2 ? std(windows) : 0;

    // pauses (silence between speech, inside the talk)
    const pauses = [];
    for (let i = 1; i < segs.length; i++) {
      const g = segs[i][0] - segs[i - 1][1];
      if (g >= 0.35) pauses.push({ at: segs[i - 1][1], len: g });
    }
    const longPauses = pauses.filter(p => p.len >= 2);
    const sentenceEnds = words.filter(x => x.endsSentence);
    const sentencePauses = sentenceEnds.filter(x => pauses.some(p => p.at >= x.end - 0.35 && p.at <= x.end + 0.6 && p.len >= 0.4)).length;
    const pauseAfterSentence = sentenceEnds.length ? sentencePauses / sentenceEnds.length : 0;

    // pitch variety (semitones around your own median)
    const voiced = [];
    for (let i = 0; i < n; i++) if (f0[i] > 0 && sp[i]) voiced.push(f0[i]);
    const med = median(voiced) || 150;
    const st = voiced.map(h => 12 * Math.log2(h / med)).filter(x => Math.abs(x) < 14);
    const pitchStd = std(st);
    const pitchRange = pct(st, 0.9) - pct(st, 0.1);

    // endings: uptalk and trailing off on statements
    const frameAt = t => clamp(Math.round(t / HOP_S), 0, n - 1);
    let uptalk = 0, trail = 0, judged = 0;
    const statementEnds = [];
    words.forEach((x, i) => { if (x.endsSentence && !x.question) statementEnds.push(i); });
    for (const i of statementEnds) {
      const x = words[i];
      const a = frameAt(x.start), b = frameAt(Math.min(dur, x.end + 0.12));
      const ctxA = frameAt(Math.max(0, x.start - 1.2));
      const endP = [], ctxP = [], endDb = [], ctxDb = [];
      for (let f = a; f <= b; f++) { if (f0[f] > 0 && sp[f]) endP.push(f0[f]); if (sp[f]) endDb.push(db[f]); }
      for (let f = ctxA; f < a; f++) { if (f0[f] > 0 && sp[f]) ctxP.push(f0[f]); if (sp[f]) ctxDb.push(db[f]); }
      if (endP.length < 3 || ctxP.length < 5) continue;
      judged++;
      const tail = endP.slice(Math.floor(endP.length / 2));
      const rise = 12 * Math.log2(median(tail) / median(ctxP));
      if (rise >= 2.5) uptalk++;
      if (endDb.length && ctxDb.length && mean(endDb) < mean(ctxDb) - 7) trail++;
    }
    const uptalkRate = judged ? uptalk / judged : 0;
    const trailRate = judged ? trail / judged : 0;

    // loudness
    const segDb = segs.map(([s, e]) => { const v = []; for (let f = frameAt(s); f < frameAt(e); f++) v.push(db[f]); return mean(v); }).filter(Number.isFinite);
    const loud = mean(segDb), loudSwing = std(segDb);

    // emotion / tone (from the Hugging Face model, if it ran)
    const emo = opts.emotion || null;
    let tone = null;
    if (emo) {
      const g = k => emo[k] || 0;
      const toneScore = clamp(4 + 8 * g('HAPPY') + 3 * g('NEUTRAL') + 2 * g('ANGRY') - 6 * g('FEAR') - 5 * g('SAD') - 2 * g('DISGUST'), 0, 10);
      const names = { HAPPY: 'upbeat', NEUTRAL: 'flat and even', ANGRY: 'intense', SAD: 'low-energy', FEAR: 'nervous', DISGUST: 'tense' };
      const top = Object.entries(emo).sort((a, b) => b[1] - a[1]);
      tone = { score: toneScore, mix: top.map(([k, v]) => ({ label: names[k] || k.toLowerCase(), key: k, share: v })) };
    }

    // ---------- scores 0–10 ----------
    const fpm = fillers / minutes, hpm = hedges / minutes;
    const target = opts.paceTarget || [140, 165];
    const s = {};
    s.pace = clamp(10 - Math.max(0, target[0] - wpm, wpm - target[1]) / 4, 0, 10);
    s.fillers = clamp(10 - 1.6 * Math.max(0, fpm - 1), 0, 10);
    s.hedges = clamp(10 - 1.3 * Math.max(0, hpm - 1), 0, 10);
    s.pitch = pitchStd < 1.5 ? 3 + pitchStd : pitchStd < 2.6 ? 4.5 + (pitchStd - 1.5) * 4.5 : pitchStd <= 5.5 ? 10 : clamp(10 - (pitchStd - 5.5) * 1.5, 6, 10);
    s.pauses = clamp(5.5 + 4.5 * pauseAfterSentence - 2.5 * (longPauses.length / minutes), 0, 10);
    s.endings = clamp(10 - 14 * uptalkRate - 10 * trailRate, 0, 10);
    if (tone) s.tone = tone.score;
    const weights = { pace: .2, fillers: .2, pitch: .15, pauses: .15, endings: .15, hedges: .05, tone: .1 };
    let tot = 0, wsum = 0;
    for (const k in s) { tot += s[k] * weights[k]; wsum += weights[k]; }
    const overall = tot / wsum;

    // ---------- plain-language feedback ----------
    const fb = [];
    const add = (key, title, value, note) => fb.push({ key, title, value, score: round(s[key]), grade: grade(s[key]), note });
    add('pace', 'Pace', `${Math.round(wpm)} words/min`,
      wpm > target[1] && wpm <= target[1] + 10 ? `A touch fast. Slow down on your key numbers so they sink in.` :
      wpm < target[0] ? `A bit slow. Pitches land best around ${target[0]}–${target[1]} words a minute. Tighten sentences instead of slowing down.`
        : wpm > target[1] ? `Fast. Aim for ${target[0]}–${target[1]} words a minute, and slow down on your key numbers so they sink in.`
          : `Right in the sweet spot for a pitch.` + (paceSwing > 35 ? ' Your speed swings a lot between sections, so keep it steady.' : ''));
    const uniq = a => [...new Set(a)].slice(0, 5).map(x => `"${x}"`).join(', ');
    add('fillers', 'Filler words', `${fillers} (${round(fpm)}/min)${fillers ? ': ' + uniq(found.filler) : ''}`,
      fpm <= 1 ? 'Clean. Almost no "um", "uh", "like" or "you know".' : `Swap each "um" or "you know" for a silent beat. Silence sounds confident; filler sounds unsure.`);
    add('pitch', 'Vocal variety', `${round(pitchStd)} semitones of movement`,
      pitchStd < 2 ? 'Fairly monotone. Lift your voice on the problem and the big number, and drop it to land a point.'
        : pitchStd > 6 ? 'Very sing-songy. Keep the energy but steady your voice on the facts.' : 'Good movement in your voice. It sounds engaged, not robotic.');
    add('pauses', 'Pauses', `${pauses.length} pauses, ${longPauses.length} long`,
      longPauses.length / minutes > 1 ? 'Several long silences (2+ seconds) read as losing your place. Know your next line cold.'
        : pauseAfterSentence < 0.4 ? 'You rarely pause after a key sentence. A one-beat pause after a big claim lets it land.'
          : s.pauses >= 8 ? 'Good use of pauses after key points.' : 'Decent pausing. Add a clear beat after your biggest claim and your ask.');
    add('endings', 'Sentence endings', `${uptalk} rising, ${trail} fading out of ${judged}`,
      uptalkRate > 0.2 ? 'Some statements end with a rising tone, like a question. End claims going down in pitch to sound certain.'
        : trailRate > 0.25 ? 'Your volume fades at the end of sentences. Push through the last word; that is usually the important one.'
          : judged && (uptalk || trail) ? 'Mostly strong endings. Watch the few that rose or faded; land them going down.' : 'You finish sentences strong and steady.');
    add('hedges', 'Hedging', `${hedges} hedge${hedges === 1 ? '' : 's'}${hedges ? ': ' + uniq(found.hedge) : ''}`,
      !hedges ? 'You state things directly.' : s.hedges >= 8 ? `Mostly direct. Swap ${uniq(found.hedge)} for a flat statement backed by a number.` : 'Softening words like "I think", "maybe" and "hopefully" undercut you. Say "We will" and back it with a number.');
    if (tone) {
      const t = tone.mix.slice(0, 2).map(m => `${m.label} ${Math.round(m.share * 100)}%`).join(', ');
      const topKey = tone.mix[0].key;
      const toneNote = {
        HAPPY: 'You sound upbeat and sure of yourself. Keep it.',
        ANGRY: 'You come across intense and forceful. Good energy, but ease off a little so it reads confident, not pushy.',
        NEUTRAL: 'Tone reads flat and even. Bring more energy to the problem and to why you care.',
        FEAR: 'The tone model hears some nerves. Slow your first line, breathe out, and smile as you start.',
        SAD: 'Tone reads low-energy. Stand up, project, and sound excited about what you built.',
        DISGUST: 'Tone reads a bit tense or clipped. Relax your jaw and let sentences finish warmly.'
      }[topKey] || 'Tone read is mixed.';
      add('tone', 'Vocal tone (AI read)', t, toneNote);
    }

    // transcript with marks
    const marked = [];
    words.forEach((x, i) => {
      const prevEnd = i ? words[i - 1].end : firstSpeech;
      const p = pauses.find(p => p.at >= prevEnd - 0.3 && p.at <= x.start + 0.1 && p.len >= 0.6);
      if (p && i) marked.push({ pause: round(p.len) });
      marked.push({ text: x.raw, tag: tags[i] });
    });

    return {
      seconds: round(dur), speakingSeconds: round(span), speechTime: round(speechTime), startDelay: round(firstSpeech),
      words: spokenWords, wpm: Math.round(wpm), fillers, hedges, fillersPerMin: round(fpm), pitchStd: round(pitchStd), pitchRange: round(pitchRange),
      pauses: pauses.length, longPauses: longPauses.length, pauseAfterSentence: round(pauseAfterSentence, 2),
      uptalk, trail, judgedEndings: judged, loudnessDb: round(loud), loudnessSwing: round(loudSwing),
      scores: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round(v)])), overall: round(overall), feedback: fb, transcript: marked, tone
    };
  }

  // speech chunks (for the tone model): up to `max` windows of ~4 s that are mostly speech
  function toneWindows(audio, max = 12) {
    const { db } = frames(audio);
    const { sp } = vad(db);
    const per = Math.round(4 / HOP_S), out = [];
    for (let f = 0; f + per <= sp.length; f += per) {
      let c = 0; for (let k = f; k < f + per; k++) c += sp[k];
      if (c / per > 0.55) out.push([f * HOP, (f + per) * HOP]);
    }
    if (out.length > max) { const step = out.length / max; return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]); }
    return out;
  }

  // Cut long audio at natural pauses into pieces Whisper handles reliably (under ~25 s each).
  function splitForASR(audio, maxS = 25) {
    const { db } = frames(audio);
    const { sp } = vad(db);
    const n = sp.length, maxF = Math.round(maxS / HOP_S);
    if (audio.length <= maxS * SR) return [[0, audio.length]];
    const cuts = [0];
    let start = 0;
    while (n - start > maxF) {
      const lo = start + Math.floor(maxF * 0.4), hi = start + maxF;
      let best = -1, bestLen = 0, i = lo;
      while (i < hi) {
        if (!sp[i]) { let j = i; while (j < hi && !sp[j]) j++; if (j - i >= bestLen) { bestLen = j - i; best = (i + j) >> 1; } i = j; }
        else i++;
      }
      if (best < 0) {
        // no silence: cut at the quietest frame
        best = lo; for (let k = lo; k < hi; k++) if (db[k] < db[best]) best = k;
      }
      cuts.push(best); start = best;
    }
    const out = [];
    for (let k = 0; k < cuts.length; k++) {
      const a = cuts[k] * HOP, b = k + 1 < cuts.length ? cuts[k + 1] * HOP : audio.length;
      if (b - a > SR * 0.3) out.push([a, b]);
    }
    return out;
  }

  root.Delivery = { analyze, toneWindows, splitForASR, SR };
  if (typeof module !== 'undefined') module.exports = root.Delivery;
})(typeof window !== 'undefined' ? window : globalThis);
