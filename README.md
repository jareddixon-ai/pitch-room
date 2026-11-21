# The Pitch Room

I'm pitching a dental insurance claims startup in UCSB's New Venture Competition. Practicing in front of a mirror doesn't tell you much. Friends are too nice. So I built a pitch coach that listens to how I sound, then puts me in front of an AI investor who grills me.

**Try it:** https://jareddixon-ai.github.io/pitch-room/ (Chrome works best)

## What it does

1. **You pitch out loud.** Pick a 1, 2 or 3 minute target and talk.
2. **Hugging Face voice models listen.** Everything runs in your browser, so your audio never leaves your computer.
   - **Whisper** (`whisper-base.en`) turns speech into text with the timing of every word.
   - **wav2vec2 speech emotion** reads your vocal tone: upbeat, flat, intense, nervous.
3. **It scores how you sounded, not just what you said:**
   - Pace in words per minute (pitches land best around 140 to 165)
   - Filler words, with the exact ones you used ("um", "like", "you know")
   - Hedging ("I think", "maybe", "hopefully")
   - Vocal variety: how much your pitch moves, measured in semitones, so you know if you sound monotone
   - Pauses: whether you let big points land, and how many 2+ second blanks you had
   - Sentence endings: statements that rise like a question (uptalk) or fade out
   - Tone, from the emotion model
4. **An AI investor grills you.** Pick a judge: a friendly angel, a tough seed VC, a TV shark, or a skeptical dentist (the actual customer). The judge reads questions out loud and pulls from 20 question types, including market size, competition, pricing, HIPAA, pushback and curveballs. If you dodge, it asks a follow-up.
5. **Every answer gets scored.** How direct, specific and convincing it was, how long you took to start talking, and a stronger answer you could have given.
6. **Progress over time.** Each session is saved so you can watch filler words drop and scores climb.

## How it's built

| Piece | How |
|---|---|
| Speech to text | Whisper base (English) with word timestamps, via [Transformers.js](https://huggingface.co/docs/transformers.js). Runs on your GPU (WebGPU) when available, otherwise CPU. |
| Vocal tone | `onnx-community/wav2vec2-base-Speech_Emotion_Recognition-ONNX`, averaged over 4 second windows of speech |
| Pitch, loudness, pauses | Measured directly from the audio: pitch tracking by autocorrelation, voice activity from loudness |
| AI judge | Any chat model on Hugging Face Inference Providers (default Llama 3.3 70B, free token) or Claude with your own API key. Without one, it uses a built-in question bank and scores delivery only. |
| App | One HTML file, no server. Keys and history stay in your browser. |

Long recordings get cut at natural pauses into pieces under 25 seconds before transcription. Whisper's built-in long-audio mode was dropping words in testing, which threw off the pace score.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app, built from `src/` |
| `src/delivery.js` | The delivery analysis: pace, pauses, fillers, hedges, pitch variety, endings, scoring |
| `src/questions.js` | Question types and the built-in question bank |
| `src/app.html` | Page layout, recording, models, AI judge |
| `build.py` | Combines `src/` into `index.html` |

## What I learned

- The models were the easy part. The hard part was turning raw numbers into feedback a person can act on, like "you rose in pitch at the end of 3 statements, so land them going down."
- Test with long audio. Short clips worked perfectly, and a 2 minute pitch quietly lost half its words until I changed how the audio gets split.
- Running models in the browser means no server bills and real privacy, but you have to plan for slow first downloads and different hardware.
