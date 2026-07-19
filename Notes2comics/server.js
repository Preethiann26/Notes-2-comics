// Notes-2-Comic backend
// Turns study notes into: (1) a comic strip, (2) a mind map, (3) a quiz.
// Also serves the frontend from /public, so one deployment = one link.

const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_NOTES_LENGTH = 6000;
const DEFAULT_PANEL_COUNT = 4;
const MAX_PANEL_COUNT = 6;
const DEFAULT_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 10;

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "WARNING: OPENAI_API_KEY is not set. Comic/quiz generation will fail until you set it " +
      "(in .env locally, or your host's environment variables in production)."
  );
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json({ limit: "2mb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);

// Image/text generation costs money per call - protect against abuse.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use("/api/", limiter);

// Serve the frontend
app.use(express.static(path.join(__dirname, "public")));

// ---------- Helpers ----------

function stripJsonFences(raw) {
  return raw.replace(/^```json\s*|^```\s*|```$/g, "").trim();
}

/** Break notes into N comic panel scenes (caption + visual description). */
async function planComicPanels(notes, panelCount, style) {
  const systemPrompt = `You are a comic script writer for students. Turn study notes into a short comic strip that teaches the concept.
Return ONLY valid JSON, no markdown fences, no extra text. Shape:
{"panels": [{"caption": "short caption (max 15 words)", "visualDescription": "detailed scene description for an illustrator, no text/words/letters in the image itself"}]}
Produce exactly ${panelCount} panels forming a clear, engaging, easy-to-follow sequence that explains the notes.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Notes:\n"""${notes}"""\n\nArt style for each visual description: ${style}.`,
      },
    ],
    temperature: 0.8,
  });

  const parsed = JSON.parse(stripJsonFences(completion.choices[0].message.content.trim()));
  if (!Array.isArray(parsed.panels) || parsed.panels.length === 0) {
    throw new Error("Model did not return any panels.");
  }
  return parsed.panels.slice(0, panelCount);
}

/** Generate one comic-style image, return base64 PNG. */
async function generatePanelImage(visualDescription, style) {
  const prompt = `Comic book panel illustration, ${style} style. Scene: ${visualDescription}. No text, no letters, no speech bubbles in the image.`;
  const result = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    n: 1,
  });
  return result.data[0].b64_json;
}

/** Build a mind map + multiple-choice quiz from notes. */
async function planMindMapAndQuiz(notes, questionCount) {
  const systemPrompt = `You are a study-tool AI. From the given notes, produce:
1. A mind map: one main topic, and 3 key concepts, each with 2 short supporting details.
2. A multiple-choice quiz with exactly ${questionCount} questions testing the notes, each with 4 options and one correct answer (0-indexed).
Return ONLY valid JSON, no markdown fences, no extra text. Shape:
{
  "mindMap": {
    "mainTopic": "short topic name",
    "keyConcepts": [
      {"title": "concept name", "details": ["detail A", "detail B"]}
    ]
  },
  "questions": [
    {"question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0}
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Notes:\n"""${notes}"""` },
    ],
    temperature: 0.6,
  });

  const parsed = JSON.parse(stripJsonFences(completion.choices[0].message.content.trim()));
  if (!parsed.mindMap || !Array.isArray(parsed.questions)) {
    throw new Error("Model did not return a valid mind map / quiz.");
  }
  return parsed;
}

// ---------- Routes ----------

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/generate-comic", async (req, res) => {
  try {
    const { notes, panelCount, style } = req.body || {};
    if (!notes || typeof notes !== "string" || !notes.trim()) {
      return res.status(400).json({ error: "Field 'notes' (non-empty string) is required." });
    }
    if (notes.length > MAX_NOTES_LENGTH) {
      return res.status(400).json({ error: `Notes too long. Max ${MAX_NOTES_LENGTH} characters.` });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });
    }

    const count = Math.min(Math.max(parseInt(panelCount, 10) || DEFAULT_PANEL_COUNT, 1), MAX_PANEL_COUNT);
    const artStyle = (style && String(style).trim()) || "colorful comic book";

    const panels = await planComicPanels(notes, count, artStyle);
    const panelsWithImages = await Promise.all(
      panels.map(async (panel) => ({
        caption: panel.caption,
        imageBase64: `data:image/png;base64,${await generatePanelImage(panel.visualDescription, artStyle)}`,
      }))
    );

    res.json({ panels: panelsWithImages });
  } catch (err) {
    console.error("generate-comic error:", err);
    res.status(500).json({ error: "Failed to generate comic. " + (err.message || "") });
  }
});

app.post("/api/generate-quiz", async (req, res) => {
  try {
    const { notes, questionCount } = req.body || {};
    if (!notes || typeof notes !== "string" || !notes.trim()) {
      return res.status(400).json({ error: "Field 'notes' (non-empty string) is required." });
    }
    if (notes.length > MAX_NOTES_LENGTH) {
      return res.status(400).json({ error: `Notes too long. Max ${MAX_NOTES_LENGTH} characters.` });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });
    }

    const count = Math.min(Math.max(parseInt(questionCount, 10) || DEFAULT_QUESTION_COUNT, 1), MAX_QUESTION_COUNT);
    const result = await planMindMapAndQuiz(notes, count);
    res.json(result);
  } catch (err) {
    console.error("generate-quiz error:", err);
    res.status(500).json({ error: "Failed to generate quiz. " + (err.message || "") });
  }
});

// Fallback to index.html for any other route (simple SPA behavior)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Notes-2-Comic server listening on port ${PORT}`);
});
