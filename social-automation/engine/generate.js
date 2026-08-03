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
function imageBlockSource(image) {
  if (!image) return null;
  if (typeof image === "string") return { type: "url", url: image };
  if (image.buffer) return { type: "base64", media_type: String(image.contentType || "image/jpeg").split(";")[0].trim(), data: Buffer.from(image.buffer).toString("base64") };
  if (image.data && image.media_type) return image; // already a source block
  return null;
}

async function describeImage(image, opts = {}) {
  const source = imageBlockSource(image);
  if (!source) return "";
  const client = opts.client || newClient();
  const msg = await client.messages.create({
    model: opts.model || REPLY_MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source },
          {
            type: "text",
            text:
              "Describe ONLY what is literally visible in this photo in one plain sentence — the food, drink, place or scene. " +
              "Do NOT guess brand names, prices, ingredients, or anything you cannot actually see. " +
              "This is a factual hint for a caption writer, not the caption.",
          },
        ],
      },
    ],
  });
  const block = (msg.content || []).find((b) => b.type === "text");
  return block ? String(block.text || "").trim() : "";
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
