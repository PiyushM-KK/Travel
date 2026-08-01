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

const Anthropic = require("@anthropic-ai/sdk");
const { factSheet } = require("./kb-adapter");
const { validatePost } = require("./validate-post");

const CAPTION_MODEL = process.env.SOCIAL_CAPTION_MODEL || "claude-sonnet-5";
const REPLY_MODEL = process.env.SOCIAL_REPLY_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = 1200;

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

Write about the specific dish or angle you are given. Be concrete about the food — texture, temperature, what the first bite is like. Avoid generic restaurant filler.`;
}

function userPromptFor(brief) {
  const bits = [
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
 * Generate + validate the posts for one calendar brief.
 *
 * @returns {{brief, posts:Array, rejected:Array, needsHuman:boolean}}
 */
async function generateForBrief(brief, facts, profile, opts = {}) {
  const client = opts.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const system = buildSystemPrompt(facts, profile);

  const call = async (messages) =>
    client.messages.create({
      model: opts.model || CAPTION_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [POST_TOOL],
      tool_choice: { type: "tool", name: POST_TOOL.name },
      messages,
    });

  const messages = [{ role: "user", content: userPromptFor(brief) }];
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
        content: `These posts FAILED fact-checking against the menu:\n\n${complaint}\n\nRewrite ALL posts. Fix every problem listed. If a price or item caused the failure, the safest fix is to not mention it at all. Do not invent anything new.`,
      },
    ]);
    candidates = extractPosts(repair);
    checked = candidates.map((p) => ({ post: p, result: validatePost(p, facts, profile) }));
    failed = checked.filter((c) => !c.result.ok);
  }

  const passed = checked.filter((c) => c.result.ok);

  return {
    brief,
    // Ready for the approval queue.
    posts: passed.map((c) => ({
      ...c.post,
      warnings: c.result.warnings,
      status: profile.autoApprove && !c.result.warnings.length ? "approved" : "pending_approval",
    })),
    // Never published, never silently dropped — surfaced to the owner.
    rejected: failed.map((c) => ({ ...c.post, errors: c.result.errors })),
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
  const client = opts.client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  buildSystemPrompt,
  POST_TOOL,
  CAPTION_MODEL,
  REPLY_MODEL,
};
