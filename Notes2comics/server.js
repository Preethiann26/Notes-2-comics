// Notes-2-Comic backend
// Turns study notes into: (1) a comic strip, (2) a mind map, (3) a quiz.
// Also serves the frontend from /public, so one deployment = one link.
//
// Text (comic script, mind map, quiz) uses Google's Gemini API - free tier,
// API key from https://aistudio.google.com/apikey
//
// Images use Pollinations.ai - a genuinely free, no-signup, no-API-key image
// generation service (https://pollinations.ai). This avoids Gemini's image
// models, which currently require billing even on "free tier" projects.

const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_NOTES_LENGTH = 6000;
const DEFAULT_PANEL_COUNT = 4;
const MAX_PANEL_COUNT = 6;
const DEFAULT_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 10;

const TEXT_MODEL = "gemini-3.5-flash";
// Pollinations' anonymous access is rate-limited to roughly 1 request per
// 15 seconds - space out panel image requests to stay under that.
const IMAGE_GEN_DELAY_MS = 5000;

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "WARNING: GEMINI_API_KEY is not set. Comic script/quiz generation will fail until you set it " +
      "(in .env locally, or your host's environment variables in production). " +
      "Get a free key at https://aistudio.google.com/apikey"
  );
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(express.json({ limit: "2mb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);

// Gemini's free tier is rate-limited per-project, not just per-user -
// keep this conservative so one visitor can't burn the whole day's quota.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
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

// Structured output schemas - these force Gemini to return valid JSON matching
// this exact shape, instead of relying on the model to format free-text JSON
// correctly (which occasionally broke on notes containing special characters).
const PANELS_SCHEMA = {
  type: "OBJECT",
  properties: {
    panels: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          caption: { type: "STRING" },
          visualDescription: { type: "STRING" },
        },
        required: ["caption", "visualDescription"],
      },
    },
  },
  required: ["panels"],
};

const MINDMAP_QUIZ_SCHEMA = {
  type: "OBJECT",
  properties: {
    mindMap: {
      type: "OBJECT",
      properties: {
        mainTopic: { type: "STRING" },
        keyConcepts: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING" },
              details: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["title", "details"],
          },
        },
      },
      required: ["mainTopic", "keyConcepts"],
    },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          correctIndex: { type: "INTEGER" },
        },
        required: ["question", "options", "correctIndex"],
      },
    },
  },
  required: ["mindMap", "questions"],
};

/** Break notes into N comic panel scenes (caption + visual description). */
async function planComicPanels(notes, panelCount, style) {
  const prompt = `You are a comic script writer for students. Turn study notes into a short comic strip that teaches the concept.
Produce exactly ${panelCount} panels forming a clear, engaging, easy-to-follow sequence that explains the notes.
Each panel needs a short caption (max 15 words) and a detailed visual scene description for an illustrator (no text/words/letters in the image itself).

Notes:
"""${notes}"""

Art style for each visual description: ${style}.`;

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: PANELS_SCHEMA,
    },
  });

  const parsed = JSON.parse(stripJsonFences(response.text.trim()));
  if (!Array.isArray(parsed.panels) || parsed.panels.length === 0) {
    throw new Error("Model did not return any panels.");
  }
  return parsed.panels.slice(0, panelCount);
}

/** Generate one comic-style image via Pollinations.ai, return base64 (no data: prefix). */
async function generatePanelImage(visualDescription, style) {
  const prompt = `Comic book panel illustration, ${style} style. Scene: ${visualDescription}. No text, no letters, no speech bubbles in the image.`;
  const encodedPrompt = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image generation failed with status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build a mind map + multiple-choice quiz from notes. */
async function planMindMapAndQuiz(notes, questionCount) {
  const prompt = `You are a study-tool AI. From the given notes, produce:
1. A mind map: one main topic, and 3 key concepts, each with 2 short supporting details.
2. A multiple-choice quiz with exactly ${questionCount} questions testing the notes, each with 4 options and one correct answer (0-indexed).

Notes:
"""${notes}"""`;

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: MINDMAP_QUIZ_SCHEMA,
    },
  });

  const parsed = JSON.parse(stripJsonFences(response.text.trim()));
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
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
    }

    const count = Math.min(Math.max(parseInt(panelCount, 10) || DEFAULT_PANEL_COUNT, 1), MAX_PANEL_COUNT);
    const artStyle = (style && String(style).trim()) || "colorful comic book";

    const panels = await planComicPanels(notes, count, artStyle);

    // Generate images one at a time, with a delay between each - Pollinations'
    // free anonymous access is rate-limited, and bursts get throttled/blocked.
    const panelsWithImages = [];
    for (let i = 0; i < panels.length; i++) {
      if (i > 0) await sleep(IMAGE_GEN_DELAY_MS);
      const imageB64 = await generatePanelImage(panels[i].visualDescription, artStyle);
      panelsWithImages.push({
        caption: panels[i].caption,
        imageBase64: `data:image/jpeg;base64,${imageB64}`,
      });
    }

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
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
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
