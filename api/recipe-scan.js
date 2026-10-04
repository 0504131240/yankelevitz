// /api/recipe-scan — reads a photographed recipe (a handwritten card, a
// cookbook page, a screenshot) and returns it split into the recipe
// editor's fields, so adding grandma's recipe is "take a photo → check →
// save". Uses Google's Gemini (free tier).
//   GET  → {enabled}: whether GEMINI_API_KEY is set, so the editor only
//          shows the scan box once the key exists — no redeploy needed.
//   POST {images:[dataUrl, ...]} (1–3 JPEG/PNG/WebP, e.g. a recipe spread
//        over two pages) → {recipe:{title, ingredients[], steps[], ...}}
// Env: GEMINI_API_KEY (Google AI Studio), optional GEMINI_MODEL.
// Same-origin only, so other sites can't use up the key's daily quota.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const IMG_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGES = 3;
const MAX_B64 = 1600000; // per image, after the browser's own downscale

const CATS = ['main', 'side', 'salad', 'soup', 'bake', 'cake', 'cookie', 'dessert', 'spread', 'drink', 'other'];
const HOLIDAYS = ['shabbat', 'rosh', 'sukkot', 'chanuka', 'tubshvat', 'purim', 'pesach', 'shavuot'];
const KOSHER = ['meat', 'dairy', 'parve', ''];

const SCHEMA = {
  type: 'object',
  properties: {
    isRecipe: { type: 'boolean', description: 'false if the image does not contain a recipe at all' },
    title: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    servings: { type: 'integer', description: '0 if not stated' },
    prepMin: { type: 'integer', description: '0 if not stated or clearly inferable' },
    cookMin: { type: 'integer', description: '0 if not stated or clearly inferable' },
    tips: { type: 'string', description: 'notes, tips or side remarks written on the recipe; empty string if none' },
    category: { type: 'string', enum: CATS },
    kosher: { type: 'string', enum: KOSHER },
    tags: { type: 'array', items: { type: 'string', enum: HOLIDAYS } }
  },
  required: ['isRecipe', 'title', 'ingredients', 'steps', 'servings', 'prepMin', 'cookMin', 'tips', 'category', 'kosher', 'tags']
};

const SYSTEM = `You transcribe photographed recipes for a Hebrew-speaking family's recipe book. The photo may be a handwritten card (often old, faded, or in a grandparent's handwriting), a cookbook page, a magazine clipping, or a screenshot. Several images are parts of the same recipe, in order.

Transcribe faithfully in the language the recipe is written in (usually Hebrew). Do not translate, embellish, or add ingredients or steps that are not written. If a word is genuinely illegible, give your best reading rather than dropping the line.

How the fields are used by the app:
- ingredients: one ingredient per array item, with the quantity at the start of the line ("2 כוסות קמח", "1/2 כוס סוכר", "חצי כפית מלח") so the app can scale quantities. Write fractions as 1/2, 1/4, 3/4. If the recipe groups ingredients (e.g. for the dough / for the filling), add the group name as its own item ending with a colon ("לבצק:") right before that group.
- steps: one step per item, without leading numbers. Keep times and temperatures as written ("אופים 40 דקות ב-180 מעלות") - the app turns times into kitchen timers.
- title: the recipe's name as written; if none is written, a short descriptive Hebrew name.
- servings / prepMin / cookMin: only when stated or clearly implied by the text (e.g. baking time); otherwise 0.
- category, kosher, tags: your best judgment from the ingredients and the dish. kosher is "meat" if it contains meat or poultry, "dairy" if it contains milk, butter, cheese or cream, "parve" otherwise, "" if unsure. tags: only holidays the recipe names or is unmistakably associated with (e.g. סופגניות → chanuka, אוזני המן → purim, a dish marked כשר לפסח → pesach); an empty array is fine.
- tips: anything else written on the recipe that is not an ingredient or a step (remarks, variations, "from aunt Rina").
- isRecipe: false only if there is no recipe in the image at all.

Reply with a single JSON object with exactly these keys: isRecipe, title, ingredients, steps, servings, prepMin, cookMin, tips, category, kosher, tags.`;

// The model's JSON is trusted only as far as its shape: everything is coerced
// to what the editor expects.
function normalize(x) {
  const strs = a => (Array.isArray(a) ? a : []).map(v => String(v == null ? '' : v).trim()).filter(Boolean).slice(0, 80);
  const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n < 100000 ? n : 0; };
  return {
    isRecipe: x.isRecipe !== false,
    title: String(x.title || '').trim().slice(0, 200),
    ingredients: strs(x.ingredients),
    steps: strs(x.steps),
    servings: int(x.servings),
    prepMin: int(x.prepMin),
    cookMin: int(x.cookMin),
    tips: String(x.tips || '').trim().slice(0, 2000),
    category: CATS.includes(x.category) ? x.category : 'other',
    kosher: KOSHER.includes(x.kosher) ? x.kosher : '',
    tags: strs(x.tags).filter(t => HOLIDAYS.includes(t))
  };
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(t);
}

async function callGemini(parts, withSchema) {
  const generationConfig = { responseMimeType: 'application/json' };
  if (withSchema) generationConfig.responseJsonSchema = SCHEMA;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts }],
      generationConfig
    })
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

module.exports = async (req, res) => {
  const configured = !!process.env.GEMINI_API_KEY;
  if (req.method === 'GET') { res.status(200).json({ enabled: configured }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const origin = req.headers.origin || '';
  if (origin && origin.replace(/^https?:\/\//, '') !== host) { res.status(403).json({ error: 'forbidden' }); return; }
  if (!configured) { res.status(503).json({ error: 'not configured' }); return; }

  const images = Array.isArray(req.body && req.body.images) ? req.body.images : [];
  if (!images.length || images.length > MAX_IMAGES) { res.status(400).json({ error: 'send 1-3 images' }); return; }
  const parts = [];
  for (const img of images) {
    const m = IMG_RE.exec(String(img || ''));
    if (!m) { res.status(400).json({ error: 'bad image' }); return; }
    if (m[2].length > MAX_B64) { res.status(413).json({ error: 'image too large' }); return; }
    parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  parts.push({ text: images.length > 1 ? `These ${images.length} images are one recipe, in order. Transcribe it.` : 'Transcribe this recipe.' });

  try {
    let { status, data } = await callGemini(parts, true);
    // An API version that doesn't know responseJsonSchema rejects the whole
    // request; the system prompt alone still asks for the same JSON shape.
    if (status === 400 && /responseJsonSchema|response_json_schema|Unknown name/i.test(JSON.stringify(data))) {
      ({ status, data } = await callGemini(parts, false));
    }
    if (status === 429) { res.status(429).json({ error: 'busy, try again' }); return; }
    if (status !== 200) {
      console.error('recipe-scan: gemini', status, JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: 'ai error ' + status });
      return;
    }
    const cand = (data.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || '').join('');
    if (!text) { res.status(422).json({ error: 'no recipe found' }); return; }
    const recipe = normalize(parseJson(text));
    if (!recipe.isRecipe || (!recipe.ingredients.length && !recipe.steps.length)) { res.status(422).json({ error: 'no recipe found' }); return; }
    res.status(200).json({ recipe });
  } catch (e) {
    console.error('recipe-scan failed:', e);
    res.status(500).json({ error: 'scan failed' });
  }
};
