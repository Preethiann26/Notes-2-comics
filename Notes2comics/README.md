# Notes 2 Comic

AI-based study tool: paste your notes, get back a comic strip explaining them,
a mind map, and an auto-generated quiz — with your score history saved locally
in the browser.

This is a **complete, self-contained app** — the Node/Express server in
`server.js` both serves the frontend (in `/public`) and powers the AI
endpoints. One deployment gives you one working link.

## How it works

1. You paste notes and click **Transform**.
2. The backend asks GPT to script your notes into comic panels, then generates
   a comic-style image for each panel (`/api/generate-comic`).
3. In parallel, it also builds a mind map (main topic + key concepts) and a
   multiple-choice quiz from the same notes (`/api/generate-quiz`).
4. You read the comic, take the quiz, and see a pass/fail results screen.
5. If you don't pass, you can review the mind map and retry.
6. Your score history is saved in your browser (localStorage) under "My Progress."

## 1. Get an OpenAI API key

1. Go to https://platform.openai.com/api-keys and sign up / log in.
2. Create a secret key and copy it.
3. Add billing at https://platform.openai.com/settings/organization/billing
   (usage is pay-as-you-go; testing a handful of comics costs cents to low dollars).

## 2. Run it locally

```bash
npm install
cp .env.example .env
# edit .env and paste your real OPENAI_API_KEY
npm start
```

Open http://localhost:3000 in your browser — the whole app runs there.

## 3. Deploy for free (Render.com) to get a public link

1. Push this whole folder to your GitHub repo (e.g. `Notes-2-Comic`), replacing
   whatever was there before.
2. Go to https://render.com, sign up, click **New +** → **Web Service**.
3. Connect your GitHub repo.
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Under **Environment**, add:
   - `OPENAI_API_KEY` = your key from step 1
6. Click **Create Web Service**. After it builds (~2-3 min), Render gives you
   a public URL like `https://notes2comic.onrender.com` — **that's your live,
   working link**, share that with anyone.

**Free-tier note:** Render's free tier sleeps after 15 min of inactivity and
takes ~30-50s to wake up on the first request after sleeping. Fine for a demo
or class project; upgrade to a paid instance ($7/mo) if you want it always-on.

(Railway.app and Fly.io work the same way if you'd rather use those.)

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

- The OpenAI key lives only on the server (Render environment variables) —
  never shipped to the browser.
- Rate limiting (30 requests/15min per IP) is built in to control API costs.
