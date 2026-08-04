/**
 * generate.js — WF2 "Generation" from the business plan, grounded in the
 * client's own kb.js and validated before anything reaches the approval queue.
 *
 * The loop is deliberately: generate -> validate -> (repair once) -> validate.
 * A post that still fails after one repair is NOT quietly dropped and NOT
 * published: it goes to the owner flagged, with the reason. Silent failure is
 * how automated social accounts go stale without anyone noticing.
 *
 * Models follow the cost split in the business plan (captions on Sonnet, replies
 * on Haiku) — both overridable by env so the economics stay tunable:
 *   SOCIAL_CAPTION_MODEL   default "claude-sonnet-5"
 *   SOCIAL_REPLY_MODEL     default "claude-haiku-4-5"
 *
 * Structured output uses forced tool use (SDK 0.57), which guarantees the shape
 * without relying on the model to format JSON by hand.
 */

const { factSheet } = require("./kb-adapter");
const { SOCIAL_PLAYBOOK } = require("./social-playbook");
const { validatePost } = require("./validate-post");

// Lazy: the SDK is only needed when we actually call the API. Requiring it at
// runtime (not import time) keeps the engine importable offline — e.g. tests
// that inject a mock client via opts.client — without the SDK installed.
function newClient() {
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const CAPTION_MODEL = process.env.SOCIAL_CAPTION_MODEL || "claude-sonnet-5";
const REPLY_MODEL = process.env.SOCIAL_REPLY_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = 1200;

/**
 * Languages a post can be drafted in. Skyline is India-based and the restaurant
 * demo serves Brampton's large South Asian community, so Hindi, Gujarati and a
 * natural code-mixed blend are first-class — not an afterthought.
 *
 * IMPORTANT SAFETY NOTE: the fact-check in validate-post.js checks the DECLARED
 * mentionedItems/claimedPrices (language-independent) AND scans the caption text
 * with English-language regex (superlatives, promos, visa/guarantee claims).
 * Those text heuristics do NOT read Devanagari or Gujarati script, so a
 * non-English caption gets less automatic caption-text screening. We compensate
 * by flagging every non-English post for mandatory human review — it can never
 * auto-approve. The grounding guarantee (no invented item/price) still holds in
 * every language because it rests on the declared fields, not on parsing prose.
 */
const LANGUAGES = {
  en: {
    label: "English",
    directive: "Write the post in natural, idiomatic English.",
  },
  hi: {
    label: "Hindi",
    directive:
      "Write the post in natural, conversational Hindi in Devanagari script — the way a warm local business actually speaks, not a stiff textbook translation. Common English words that Hindi speakers use everyday (like 'weekend', 'trip', 'pickup') can stay in English where that reads naturally.",
  },
  gu: {
    label: "Gujarati",
    directive:
      "Write the post in natural, conversational Gujarati in Gujarati script — warm and local, not a literal translation. Everyday English words Gujarati speakers mix in naturally can stay in English.",
  },
  mix: {
    label: "English + Hindi + Gujarati mix",
    directive:
      "Write in a natural code-mixed blend of English, Hindi and Gujarati — the way many Indian and diaspora audiences genuinely speak and post on social media (Hinglish with a Gujarati flavour). Mix within sentences where it flows; keep it warm, readable and authentic, never a jumbled word-salad or the same phrase repeated in three languages.",
  },
};

/** True if the text contains Devanagari or Gujarati script (drift backstop). */
function hasNonLatinScript(text) {
  return /[ऀ-ॿ઀-૿]/.test(String(text || ""));
}

/** Normalise whatever the brief/profile says into a supported language code. */
function resolveLanguage(brief = {}, profile = {}) {
  const raw = String((brief && brief.language) || (profile && profile.language) || "en")
    .toLowerCase()
    .trim();
  const alias = {
    en: "en", english: "en",
    hi: "hi", hindi: "hi",
    gu: "gu", gujarati: "gu", guj: "gu",
    mix: "mix", mixed: "mix", multi: "mix", all: "mix",
    "en+hi+gu": "mix", hinglish: "mix",
  };
  return alias[raw] || (LANGUAGES[raw] ? raw : "en");
}

/**
 * The instruction the model gets for a given language, plus the invariant that
 * keeps the fact-check working across languages: the DECLARED item names and
 * prices must stay in the exact fact-sheet spelling regardless of caption
 * language, because those declarations are what gets verified.
 */
function languageDirective(code) {
  const lang = LANGUAGES[code] || LANGUAGES.en;
  const invariant =
    "Whatever language the CAPTION is in, the values you put in mentionedItems and claimedPrices MUST be the exact names and prices from the fact sheet — do NOT translate them. They are checked automatically. Proper nouns (place, package and dish names) may stay in their original spelling. Hashtags may stay in English for discoverability.";
  return `LANGUAGE: ${lang.directive}\n${invariant}`;
}

/** The schema the model is forced into. */
const POST_TOOL = {
  name: "emit_posts",
  description: "Return the finished social posts, one per platform.",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            platform: { type: "string", enum: ["instagram", "facebook", "google_business"] },
            caption: { type: "string", description: "The post text, ready to publish." },
            hashtags: { type: "array", items: { type: "string" } },
            cta: { type: "string", description: "The call to action used." },
            mentionedItems: {
              type: "array",
              items: { type: "string" },
              description:
                "EXACT names of every menu item referred to in the caption. Must match the fact sheet exactly. This is checked.",
            },
            claimedPrices: {
              type: "array",
              items: {
                type: "object",
                properties: { item: { type: "string" }, price: { type: "string" } },
                required: ["item", "price"],
              },
              description: "Any price stated in the caption. Must match the fact sheet exactly.",
            },
          },
          required: ["platform", "caption", "hashtags", "mentionedItems", "claimedPrices"],
        },
      },
    },
    required: ["posts"],
  },
};

/**
 * The grounding contract. Mirrors the chatbot's rules, because it is the same
 * promise to the same client — just pointed outward instead of inward.
 */
function buildSystemPrompt(facts, profile) {
  return `You write social media posts for ${facts.business.name}, a ${facts.business.cuisine} business.

THE FACTS YOU MAY USE ARE BELOW. THEY ARE THE ONLY FACTS THAT EXIST.

${factSheet(facts)}

RULES — these are absolute:
1. NEVER invent a menu item. Only name dishes that appear in the fact sheet above, spelled exactly as written there.
2. NEVER invent or alter a price. If you state a price it must match the fact sheet exactly. If you are not certain, do not mention a price at all.
3. NEVER invent hours, addresses, phone numbers, or locations.
4. NEVER announce a discount, promotion, giveaway or limited-time offer. The restaurant would have to honour it at the counter.
5. NEVER claim a certification (halal certified, kosher, organic, gluten-free) or any allergen or health claim. The fact sheet says what is true about the food — say only that, in its own terms.
6. NEVER claim awards, rankings or "best in the city". They are unverifiable.
7. Declare every menu item you mention in mentionedItems, and every price in claimedPrices. These are checked against the menu automatically.

VOICE:
- Tone: ${profile.tone}
- Emoji: ${profile.emojiPolicy}
- Never use these words: ${(profile.bannedWords || []).join(", ")}
${profile.exampleCaptions && profile.exampleCaptions.length
      ? `- Match the cadence of the owner's own writing:\n${profile.exampleCaptions.map((c) => `  "${c}"`).join("\n")}`
      : "- Write the way a proud owner talks about their own food: plain, specific, unpretentious."}

PLATFORM NOTES:
- instagram: warm and visual, hashtags at the end, max ${profile.maxHashtagsInstagram} hashtags.
- facebook: slightly longer, more conversational, very few hashtags.
- google_business: informational and local-search focused. NO hashtags. Mention the neighbourhood and what to order.

EXPERT SOCIAL-MEDIA CRAFT — apply this playbook (it does NOT override the grounding rules above; accuracy always wins):
${SOCIAL_PLAYBOOK}

Write about the specific dish or angle you are given. Be concrete about the food — texture, temperature, what the first bite is like. Avoid generic restaurant filler.`;
}

function userPromptFor(brief, language = "en") {
  const bits = [
    languageDirective(language),
    "",
    `POST TYPE: ${brief.label}`,
    `SUBJECT: ${brief.subject}`,
    `ANGLE: ${brief.angle}`,
  ];
  if (brief.suggestedItems && brief.suggestedItems.length) {
    bits.push(`ITEMS TO FEATURE (exact names): ${brief.suggestedItems.join(", ")}`);
  }
  if (brief.photoCaption) bits.push(`WHAT THE PHOTO SHOWS: ${brief.photoCaption}`);
  bits.push("", "Write one post for each of: instagram, facebook, google_business.");
  return bits.join("\n");
}

function extractPosts(message) {
  const block = (message.content || []).find(
    (b) => b.type === "tool_use" && b.name === POST_TOOL.name
  );
  if (!block) throw new Error("model did not return the emit_posts tool call");
  return (block.input && block.input.posts) || [];
}

/**
 * Claude vision: describe ONLY what is literally visible in a photo, as a hint
 * for the caption writer. This does NOT loosen grounding — the hint guides the
 * angle, but generateForBrief still declares mentionedItems/claimedPrices that
 * are checked against the fact base, so a photo can't smuggle in an off-menu
 * claim. Returns "" if there is no image.
 *
 * @param {string|object} image  a public https URL (string) OR raw bytes
 *        ({buffer, contentType}) — the publish-time-only model passes BYTES at draft
 *        so the image never needs a public URL just to be analysed.
 * @param {object} opts       { client, model } — client injectable for tests
 */
/**
 * Build a Claude vision image source from either a public URL (string) or raw bytes
 * ({buffer, contentType}). Kept in the engine so it has no automation/ dependency.
 * Returns null when there's no image.
 */
// Read an image's pixel dimensions straight from its HEADER — cheap, no decode/allocation. Covers
// PNG / GIF / JPEG (the formats email posters use); returns null for anything else (incl. WebP).
function imageDims(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; // PNG IHDR
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }; // GIF
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG — walk to a Start-Of-Frame marker
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      const len = buf.readUInt16BE(o + 2); if (len < 2) break; o += 2 + len;
    }
  }
  return null;
}

// Large images (e.g. a 2–3 MB vendor poster) can make the vision model return an EMPTY reading, so
// downscale to <=1568px (Anthropic's recommended max edge) as JPEG. SECURITY: never decode an image
// whose HEADER declares a huge or unknown canvas — jimp would allocate w*h*4 bytes and can OOM the
// serverless fn (an OOM is NOT a catchable throw). Those are sent raw for Anthropic to bound safely.
// Sniff the real media type from the magic bytes (a caller may pass bytes with no/incorrect type).
function sniffImageMime(buf, fallback) {
  if (buf && buf.length > 3) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
    if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
    if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
    if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  }
  return String(fallback || "image/jpeg").split(";")[0].trim();
}

const MAX_DECODE_PIXELS = 25 * 1000 * 1000; // 25 MP ceiling before we ever allocate a bitmap
async function downscaleForVision(buffer, contentType) {
  const mt = sniffImageMime(buffer, contentType);
  if (!buffer || buffer.length <= 1024 * 1024) return { buffer, media_type: mt }; // small enough already
  const dims = imageDims(buffer);
  if (!dims) return { buffer, media_type: mt };                                   // unknown format → don't risk a decode
  if (dims.w * dims.h > MAX_DECODE_PIXELS) return { buffer, media_type: mt };      // pixel-bomb guard (send raw)
  if (dims.w <= 1568 && dims.h <= 1568) return { buffer, media_type: mt };         // already within the edge → no decode
  try {
    const { Jimp } = require("jimp");
    const img = await Jimp.read(buffer);
    const out = await img.scaleToFit({ w: 1568, h: 1568 }).getBuffer("image/jpeg", { quality: 85 });
    return { buffer: out, media_type: "image/jpeg" };
  } catch (e) { return { buffer, media_type: mt }; }
}

async function imageBlockSource(image) {
  if (!image) return null;
  if (typeof image === "string") return { type: "url", url: image };
  // Accept a raw Node Buffer OR { buffer, contentType }. (A raw Buffer also has a `.buffer`
  // ArrayBuffer property, so check Buffer.isBuffer FIRST or we'd read the wrong bytes.)
  const bytes = Buffer.isBuffer(image) ? image : (image.buffer ? Buffer.from(image.buffer) : null);
  if (bytes) {
    const { buffer, media_type } = await downscaleForVision(bytes, image.contentType);
    return { type: "base64", media_type, data: Buffer.from(buffer).toString("base64") };
  }
  if (image.data && image.media_type) return image; // already a source block
  return null;
}

async function describeImage(image, opts = {}) {
  const source = await imageBlockSource(image);
  if (!source) return "";
  const client = opts.client || newClient();
  // The light vision model (REPLY_MODEL) occasionally returns an EMPTY description on a
  // dense / text-heavy / multilingual image (e.g. a promo poster). That empty then
  // cascades into a hold when the post has no caption hint to fall back on. So: retry on
  // empty, and on the final attempt escalate to the stronger caption model. Latency/cost
  // only grows on the rare empty; the common case still returns on the first call.
  const models = [opts.model || REPLY_MODEL];
  if (!opts.model && CAPTION_MODEL && CAPTION_MODEL !== REPLY_MODEL) models.push(CAPTION_MODEL);
  const attempts = Math.max(1, opts.attempts || 3);
  const prompt =
    "Describe the VISUAL SCENE, colours and mood of this image in one or two plain sentences — the places, landscapes, food, " +
    "or subjects actually shown (e.g. snow-capped peaks, a lake at dusk, a festive table). " +
    "IGNORE and do NOT transcribe any text, prices, package names, logos, phone numbers or contact details printed on it — " +
    "describe only what the picture SHOWS, not what it says. Do NOT guess anything you cannot see. " +
    "Reply with just the sentence(s), no headings or markdown. This is a factual scene hint for a caption writer.";
  let lastText = "";
  for (let i = 0; i < attempts; i++) {
    const model = models[Math.min(i, models.length - 1)];
    let msg;
    try {
      msg = await client.messages.create({
        model,
        max_tokens: 300,
        messages: [{ role: "user", content: [{ type: "image", source }, { type: "text", text: prompt }] }],
      });
    } catch (e) { continue; } // transient API error -> retry (next attempt may escalate the model)
    // Join ALL text blocks (the model may split), strip a stray markdown heading.
    const text = (msg.content || [])
      .filter((b) => b.type === "text")
      .map((b) => String(b.text || ""))
      .join(" ")
      .replace(/^#+\s.*$/gm, "")
      .trim();
    if (text) return text;
    lastText = text;
  }
  return lastText; // "" only if every attempt (incl. the escalated model) came back empty
}

/**
 * classifyImageForEnhance — is this a text-free PHOTOGRAPH, or a GRAPHIC (poster/flyer/ad
 * with text or prices)? AI image enhancement GARBLES text, so the enhance stage must only
 * touch photos. Returns "photo" | "graphic" (defaults to "graphic" on any doubt — the SAFE
 * side: a doubtful image is posted as-is rather than risk garbling text).
 */
async function classifyImageForEnhance(image, opts = {}) {
  const source = await imageBlockSource(image);
  if (!source) return "graphic";
  const client = opts.client || newClient();
  try {
    const msg = await client.messages.create({
      model: opts.model || REPLY_MODEL,
      max_tokens: 8,
      messages: [{
        role: "user",
        content: [
          { type: "image", source },
          { type: "text", text:
            "Is this a plain PHOTOGRAPH (a real photo of a place/scene/food/people with little or no overlaid text), " +
            "or a GRAPHIC (a poster, flyer, advertisement, or any image with significant text, prices, or logos on it)? " +
            "Answer with exactly one word: PHOTO or GRAPHIC." },
        ],
      }],
    });
    const block = (msg.content || []).find((b) => b.type === "text");
    const ans = block ? String(block.text || "").toUpperCase() : "";
    return /\bPHOTO\b/.test(ans) && !/\bGRAPHIC\b/.test(ans) ? "photo" : "graphic";
  } catch (e) {
    return "graphic"; // safe default — don't enhance if we can't be sure it's text-free
  }
}

/**
 * describeOffer — pull ONLY the travel destinations/places + season/theme from a vendor's
 * offer image, for the #3 "idea, not poster" flow: we use it to brief a SKYLINE post, and we
 * do NOT post the vendor's image. Deliberately EXCLUDES any company name, phone, website, or
 * price so the brief can't drag a competitor's brand or an unverifiable price into our caption.
 */
async function describeOffer(image, opts = {}) {
  const source = await imageBlockSource(image);
  if (!source) return "";
  const client = opts.client || newClient();
  try {
    const msg = await client.messages.create({
      model: opts.model || REPLY_MODEL,
      max_tokens: 120,
      messages: [{
        role: "user",
        content: [
          { type: "image", source },
          { type: "text", text:
            "List ONLY the travel destinations/places and the season or theme this travel offer features " +
            "(e.g. 'Himachal & Ladakh — Manali, Shimla, Leh, Pangong; winter'). Do NOT include any company " +
            "name, logo, phone number, website, or price. Reply as a short phrase, no sentences." },
        ],
      }],
    });
    const block = (msg.content || []).find((b) => b.type === "text");
    return block ? String(block.text || "").replace(/^#+\s.*$/gm, "").trim() : "";
  } catch (e) { return ""; }
}

/**
 * extractPrices — read the PER-PERSON package prices from a vendor's offer image (for the
 * reseller card: we mark these up +10% to get Skyline's price). Returns an array of INR
 * numbers (empty on none/error). Filters out phone numbers, years, etc. by magnitude.
 */
async function extractPrices(image, opts = {}) {
  const source = await imageBlockSource(image);
  if (!source) return [];
  const client = opts.client || newClient();
  try {
    const msg = await client.messages.create({
      model: opts.model || REPLY_MODEL,
      max_tokens: 60,
      messages: [{
        role: "user",
        content: [
          { type: "image", source },
          { type: "text", text:
            "List EVERY per-person package PRICE shown in this image as plain numbers in INR, " +
            "comma-separated (e.g. 10750,12400,14700). Ignore phone numbers, years, pincodes, and " +
            "any non-price number. If there are no prices, reply exactly NONE." },
        ],
      }],
    });
    const block = (msg.content || []).find((b) => b.type === "text");
    const t = block ? String(block.text || "") : "";
    if (/\bNONE\b/i.test(t)) return [];
    return (t.match(/\d[\d,]{2,}/g) || [])
      .map((s) => Number(s.replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n >= 1000 && n <= 1000000);
  } catch (e) { return []; }
}

/**
 * detectForeignBrand — does this image show a brand/logo/phone/website that is NOT the
 * client's own? A vendor's B2B poster carries the SUPPLIER's branding, and posting it to the
 * client's feed would advertise the supplier — so we HOLD it (the #2 approval guardrail).
 * The client's OWN branding is fine. Returns { foreign:bool, brand:string }. On any doubt or
 * error → { foreign:false } (don't block on a flaky call; the human still approves).
 */
async function detectForeignBrand(image, opts = {}) {
  const source = await imageBlockSource(image);
  if (!source) return { foreign: false, brand: "" };
  const clientName = String(opts.clientName || "the client").trim();
  const client = opts.client || newClient();
  try {
    const msg = await client.messages.create({
      model: opts.model || REPLY_MODEL,
      max_tokens: 40,
      messages: [{
        role: "user",
        content: [
          { type: "image", source },
          { type: "text", text:
            `The account posting this image is "${clientName}". Does the image show a BUSINESS brand name, logo, ` +
            `phone number, or website that belongs to a DIFFERENT company (a competitor/supplier), NOT "${clientName}"? ` +
            `Ignore generic place names and the client's own branding. Answer strictly as: "NONE" if there is no ` +
            `other-company branding, or "FOREIGN: <the other brand/name/number you see>".` },
        ],
      }],
    });
    const block = (msg.content || []).find((b) => b.type === "text");
    const ans = block ? String(block.text || "").trim() : "";
    if (/^\s*FOREIGN\b/i.test(ans)) return { foreign: true, brand: ans.replace(/^\s*FOREIGN:\s*/i, "").slice(0, 120) };
    return { foreign: false, brand: "" };
  } catch (e) {
    return { foreign: false, brand: "" };
  }
}

/**
 * Generate + validate the posts for one calendar brief.
 *
 * @returns {{brief, posts:Array, rejected:Array, needsHuman:boolean}}
 */
async function generateForBrief(brief, facts, profile, opts = {}) {
  const client = opts.client || newClient();
  const system = buildSystemPrompt(facts, profile);
  // Language: an explicit opt wins, then the brief, then the client default.
  const language = resolveLanguage(
    { language: opts.language != null ? opts.language : brief && brief.language },
    profile
  );

  const call = async (messages) =>
    client.messages.create({
      model: opts.model || CAPTION_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [POST_TOOL],
      tool_choice: { type: "tool", name: POST_TOOL.name },
      messages,
    });

  const messages = [{ role: "user", content: userPromptFor(brief, language) }];
  let candidates = extractPosts(await call(messages));

  let checked = candidates.map((p) => ({ post: p, result: validatePost(p, facts, profile) }));
  let failed = checked.filter((c) => !c.result.ok);

  // ---- One repair attempt, with the specific failures quoted back ----
  if (failed.length) {
    const complaint = failed
      .map((f) => `- ${f.post.platform}: ${f.result.errors.join("; ")}`)
      .join("\n");

    const repair = await call([
      ...messages,
      { role: "assistant", content: `Generated ${candidates.length} posts.` },
      {
        role: "user",
        content: `These posts FAILED fact-checking against the menu:\n\n${complaint}\n\nRewrite ALL posts in the SAME language as before. Fix every problem listed. If a price or item caused the failure, the safest fix is to not mention it at all. Do not invent anything new.`,
      },
    ]);
    candidates = extractPosts(repair);
    checked = candidates.map((p) => ({ post: p, result: validatePost(p, facts, profile) }));
    failed = checked.filter((c) => !c.result.ok);
  }

  const passed = checked.filter((c) => c.result.ok);

  // A non-English caption gets less automatic caption-text screening (the risky-
  // claim heuristics are English regex), so it must ALWAYS be seen by a human —
  // it can never auto-approve. This warning is what forces that.
  const langWarning =
    language === "en"
      ? null
      : `non-English caption (${LANGUAGES[language].label}) — the English caption-text checks can't screen this script, so a human must review before publishing`;

  return {
    brief,
    language,
    // Ready for the approval queue.
    posts: passed.map((c) => {
      const warnings = [...c.result.warnings];
      if (langWarning) warnings.push(langWarning);
      // BACKSTOP: even if language is 'en', if the model drifted and returned
      // Devanagari/Gujarati text, the English checks didn't screen it — force a
      // human review rather than let it auto-approve.
      else if (hasNonLatinScript(c.post.caption)) {
        warnings.push("caption contains non-Latin script but the language is 'en' — flagged for human review (checks are English-based)");
      }
      return {
        ...c.post,
        language,
        warnings,
        status: profile.autoApprove && !warnings.length ? "approved" : "pending_approval",
      };
    }),
    // Never published, never silently dropped — surfaced to the owner.
    rejected: failed.map((c) => ({ ...c.post, language, errors: c.result.errors })),
    needsHuman: failed.length > 0,
  };
}

/**
 * Review / DM replies (WF-reviews). Same fact base, cheaper model.
 * Replies never invent, never promise a refund or comp, and escalate anything
 * that needs the owner — a bot that promises a free meal has spent the owner's
 * money without asking.
 */
async function generateReviewReply(review, facts, profile, opts = {}) {
  const client = opts.client || newClient();

  const system = `You write short, warm replies to customer reviews for ${facts.business.name}.

FACTS YOU MAY USE:
${factSheet(facts)}

RULES:
1. 2-3 sentences. Sound like the owner, not a corporation.
2. NEVER invent menu items, prices, hours or policies.
3. NEVER offer a refund, free item, discount or compensation. You cannot spend the owner's money. If a complaint clearly needs one, set needsOwner true.
4. For a negative review: acknowledge specifically, do not argue, do not blame the customer, and invite them to contact the restaurant directly.
5. For anything alleging illness, injury, discrimination, or legal threat: write NO public reply. Set needsOwner true and say why.
6. Never claim certifications or allergen safety.`;

  const TOOL = {
    name: "emit_reply",
    description: "Return the review reply.",
    input_schema: {
      type: "object",
      properties: {
        reply: { type: "string" },
        needsOwner: { type: "boolean" },
        reason: { type: "string", description: "Why the owner must handle it, if needsOwner." },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative", "serious"] },
      },
      required: ["reply", "needsOwner", "sentiment"],
    },
  };

  const msg = await client.messages.create({
    model: opts.model || REPLY_MODEL,
    max_tokens: 400,
    system,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: `Rating: ${review.rating}/5\nPlatform: ${review.platform || "google"}\nReview: ${review.text}`,
      },
    ],
  });

  const block = (msg.content || []).find((b) => b.type === "tool_use");
  if (!block) throw new Error("model did not return the emit_reply tool call");
  const out = block.input;

  // A reply is a public statement — validate it like a post.
  const check = validatePost(
    { platform: "facebook", caption: out.reply, hashtags: [], mentionedItems: [], claimedPrices: [] },
    facts,
    profile
  );
  if (!check.ok) {
    return { ...out, needsOwner: true, reason: `failed fact-check: ${check.errors.join("; ")}` };
  }
  return out;
}

module.exports = {
  generateForBrief,
  generateReviewReply,
  describeImage,
  classifyImageForEnhance,
  detectForeignBrand,
  describeOffer,
  extractPrices,
  imageBlockSource,
  buildSystemPrompt,
  userPromptFor,
  resolveLanguage,
  languageDirective,
  LANGUAGES,
  POST_TOOL,
  CAPTION_MODEL,
  REPLY_MODEL,
};
