# Notes 2 Comic

AI-based study tool: paste your notes, get back a comic strip explaining them,
a mind map, and an auto-generated quiz — with your score history saved locally
in the browser.

This is a **complete, self-contained app** — the Node/Express server in
`server.js` both serves the frontend (in `/public`) and powers the AI
endpoints. One deployment gives you one working link.

**This version uses Google's Gemini API**, which has a real free tier (no
credit card required) — unlike OpenAI, which now requires paid billing for
API access.

## How it works

1. You paste notes and click **Transform**.
2. The backend asks Gemini to script your notes into comic panels, then
   generates a comic-style image for each panel (`/api/generate-comic`).
3. In parallel, it also builds a mind map (main topic + key concepts) and a
   multiple-choice quiz from the same notes (`/api/generate-quiz`).
4. You read the comic, take the quiz, and see a pass/fail results screen.
5. If you don't pass, you can review the mind map and retry.
6. Your score history is saved in your browser (localStorage) under "My Progress."

## 1. Get a free Gemini API key

1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account.
3. Click **Create API key**. No credit card is required for the free tier.
4. Copy the key.

**Free tier limits:** Gemini's free tier is rate-limited (a certain number of
requests per minute and per day, which Google adjusts over time) — plenty
for a personal project or class demo, but check
https://ai.google.dev/gemini-api/docs/rate-limits for the current numbers if
you hit a "quota exceeded" error.

## 2. Run it locally

```bash
npm install
cp .env.example .env
# edit .env and paste your real GEMINI_API_KEY
npm start
```

Open http://localhost:3000 in your browser — the whole app runs there.

## 3. Deploy for free (Render.com) to get a public link

1. Push this whole folder to your GitHub repo (e.g. `Notes-2-comics`),
   replacing whatever was there before. Make sure the folder structure is:
   ```
   server.js
   package.json
   public/
     index.html
     style.css
     app.js
   ```
2. Go to https://render.com, sign up, click **New +** → **Web Service**.
3. Connect your GitHub repo.
4. Settings:
   - **Root Directory:** the folder containing `server.js`, if it's nested
     inside a subfolder in your repo (leave blank if `server.js` is at the
     repo root)
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Under **Environment**, add:
   - `GEMINI_API_KEY` = your key from step 1
6. Click **Create Web Service**. After it builds (~2-3 min), Render gives you
   a public URL like `https://notes2comic.onrender.com` — **that's your live,
   working link**, share that with anyone.

**Free-tier note:** Render's free tier sleeps after 15 min of inactivity and
takes ~30-50s to wake up on the first request after sleeping. Fine for a demo
or class project; upgrade to a paid instance ($7/mo) if you want it always-on.

## What's simplified for now (good "next steps" to mention if asked)

- **No real user accounts** — progress is saved per-browser via localStorage,
  not a shared account system. Good enough for a personal demo; a real
  multi-device version would need a database (e.g. Postgres) and login.
- **Quiz grading happens in the browser** — fine for a study tool, but someone
  could technically view the answers in the browser's dev tools. Not a concern
  for a personal learning app; would matter for a graded/proctored exam tool.
- **File upload only supports plain text (.txt/.md)** — the docs mention
  uploading images/PDFs; parsing those would need an added OCR/PDF-text step,
  which can be added later (e.g. `pdf-parse` for PDFs).
- **Free-tier rate limits** — since Gemini's free tier caps requests per
  minute/day, heavy simultaneous use (e.g. a whole class testing at once)
  may occasionally hit "quota exceeded" errors. That's a Google-side limit,
  not a bug — retrying after a minute usually works.

## API reference

**POST** `/api/generate-comic`
```json
{ "notes": "your notes", "panelCount": 4, "style": "colorful comic book" }
```
→ `{ "panels": [{ "caption": "...", "imageBase64": "data:image/png;base64,..." }] }`

**POST** `/api/generate-quiz`
```json
{ "notes": "your notes", "questionCount": 5 }
```
→
```json
{
  "mindMap": { "mainTopic": "...", "keyConcepts": [{ "title": "...", "details": ["...", "..."] }] },
  "questions": [{ "question": "...", "options": ["...","...","...","..."], "correctIndex": 0 }]
}
```

## Security notes

- The Gemini key lives only on the server (Render environment variables) —
  never shipped to the browser.
- Rate limiting (20 requests/15min per IP) is built in on top of Gemini's own
  free-tier limits, to keep usage spread out.
