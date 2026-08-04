/**
 * review-agents.js — the senior "agent team" that sits on top of the mechanical
 * fact-check. Two experienced personas, each a distinct Claude call with a forced
 * structured output:
 *
 *   Social Media Manager (20 yrs) — reviewAsSocialMediaManager()
 *     A second set of eyes on a DRAFT before it reaches the client. Judges hook,
 *     clarity, CTA, platform fit and brand voice, and can suggest a stronger
 *     caption. It does NOT replace the fact-check — a suggested revision is still
 *     re-validated by the caller before it's used.
 *
 *   Public Relations Manager (20 yrs) — respondAsPRManager()
 *     Handles a customer review / comment. Triages severity (routine / sensitive
 *     / crisis), drafts a warm owner-voice reply, and — critically — writes NO
 *     public reply for anything alleging illness, injury, discrimination or legal
 *     threat; those go straight to the owner.
 *
 * SHARED SAFETY (both personas): only the client's facts; never invent an item,
 * price, promo or claim; never offer a refund/comp (that spends the owner's
 * money); escalate anything serious to a human. Nothing here posts anything —
 * the SMM feeds generate, the PR draft feeds owner approval.
 */

const { factSheet } = require("./kb-adapter");
const { SOCIAL_PLAYBOOK } = require("./social-playbook");
const { imageBlockSource } = require("./generate");

function newClient() {
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ---------------------------------------------------------------- Social Media Manager
const SMM_TOOL = {
  name: "smm_review",
  description: "Return the social media manager's verdict on the draft post.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "revise", "reject"] },
      score: { type: "integer", description: "Overall quality 1-10." },
      notes: { type: "string", description: "One or two sentences: the single most useful critique." },
      suggestedCaption: {
        type: "string",
        description: "Only when verdict is 'revise': a stronger caption using ONLY the same facts. Empty otherwise.",
      },
    },
    required: ["verdict", "score", "notes"],
  },
};

async function reviewAsSocialMediaManager(post, context = {}, opts = {}) {
  const { facts, profile = {} } = context;
  if (!facts) throw new Error("reviewAsSocialMediaManager needs context.facts");
  const client = opts.client || newClient();

  const system =
    `You are a social media manager with 20 years of experience running Instagram and Facebook for small hospitality and travel businesses. ` +
    `You review a DRAFT post before it is shown to the business owner. Judge it against the playbook below: does the first line stop the scroll (hook), is it clear and specific, is there ONE clear call to action, does it fit the platform, and does it sound like this brand. Give the single critique that matters most — not a checklist.\n\n` +
    `HARD RULES: use ONLY the facts below. Never suggest inventing a dish, price, promotion, award or claim. Any revision must stay 100% grounded in these facts. If the draft states something the facts do not support, or is misleading, the verdict is "reject". Keep any revision in the same language as the draft.\n\n` +
    `${SOCIAL_PLAYBOOK}\n\n${factSheet(facts)}\n\nBrand voice: ${profile.tone || "warm, plain, unpretentious"}.`;

  const msg = await client.messages.create({
    model: opts.model || process.env.SOCIAL_CAPTION_MODEL || "claude-sonnet-5",
    max_tokens: 500,
    system,
    tools: [SMM_TOOL],
    tool_choice: { type: "tool", name: SMM_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Platform: ${post.platform}\nCaption: ${post.caption}\nHashtags: ${(post.hashtags || []).join(" ")}\nCTA: ${post.cta || "(none)"}`,
      },
    ],
  });
  const block = (msg.content || []).find((b) => b.type === "tool_use" && b.name === SMM_TOOL.name);
  if (!block) throw new Error("Social Media Manager did not return a review");
  const out = block.input || {};
  return {
    verdict: out.verdict || "pass",
    score: Number(out.score) || 0,
    notes: String(out.notes || "").trim(),
    suggestedCaption: String(out.suggestedCaption || "").trim(),
  };
}

// ------------------------------------------------ SMM: review a FINISHED design (vision)
// For the "client sends a finished post" flow (AUTOMATION-PLAN v2, trigger 1/2): the
// SMM LOOKS AT the client's design, writes a ready-to-post caption for it, AND gives
// concrete improvement suggestions ("add a call-to-action", "the date isn't visible").
// The caption declares mentionedItems/claimedPrices so the caller can fact-check it
// (same guard as generate) before it reaches approval; suggestions are advisory.
const CREATIVE_TOOL = {
  name: "creative_review",
  description: "Caption a client's finished design and suggest improvements to it.",
  input_schema: {
    type: "object",
    properties: {
      caption: { type: "string", description: "A ready-to-post caption for THIS image, grounded ONLY in the facts. In the requested language." },
      hashtags: { type: "array", items: { type: "string" }, description: "3-6 relevant hashtags, no # sign." },
      suggestions: { type: "array", items: { type: "string" }, description: "Concrete improvements to the design/post (missing CTA, unclear offer, price/date/contact not visible, low contrast…). Empty if it is strong as-is." },
      verdict: { type: "string", enum: ["ready", "suggest_changes"] },
      language: { type: "string", description: "The caption's language: en | hi | gu | mix." },
      mentionedItems: { type: "array", items: { type: "string" }, description: "Products/dishes/packages NAMED in the caption (for the fact-check)." },
      claimedPrices: { type: "array", items: { type: "string" }, description: "Any price/offer figure the caption states (for the fact-check)." },
    },
    required: ["caption", "verdict"],
  },
};

/**
 * Look at a client's FINISHED design (imageUrl) and return { caption, hashtags,
 * suggestions, verdict, language, mentionedItems, claimedPrices }. The image is the
 * hero; the caption supports it. Vision-based — needs a model with image input.
 * `opts.client` is injectable for offline tests.
 */
async function reviewCreative(image, context = {}, opts = {}) {
  const { facts, profile = {} } = context;
  if (!facts) throw new Error("reviewCreative needs context.facts");
  // Accept a public URL (string) OR raw bytes ({buffer, contentType}) — the publish-time-
  // only model reviews the design from BYTES so it isn't hosted publicly before approval.
  const source = imageBlockSource(image);
  if (!source) throw new Error("reviewCreative needs an image (url string or {buffer, contentType})");
  const client = opts.client || newClient();
  const language = opts.language || profile.language || "en";

  const system =
    `You are a social media manager with 20 years of experience running Instagram and Facebook for small hospitality and travel businesses. ` +
    `You are shown a FINISHED design the business wants to post. Do TWO things: (1) write ONE ready-to-post caption for it (the image is the hero — the caption supports it, doesn't repeat everything), and (2) give concrete, specific suggestions to improve the design or the post — a missing call-to-action, an unclear offer, a price/date/contact that isn't visible, weak contrast — or return an empty list if it is strong as-is.\n\n` +
    `HARD RULES: for any claim in your CAPTION use ONLY the facts below; never invent a price, dish, package, promo or date. If the DESIGN itself shows a claim you cannot verify from the facts (e.g. a price), do NOT repeat it as fact in the caption — instead add a suggestion like "confirm the shown price is current". List every product/package you name in mentionedItems and every price figure in claimedPrices so it can be fact-checked. Write the caption in: ${language}.\n\n` +
    `Judge the design and write the caption against this playbook:\n${SOCIAL_PLAYBOOK}\n\n${factSheet(facts)}\n\nBrand voice: ${profile.tone || "warm, plain, unpretentious"}.`;

  const msg = await client.messages.create({
    model: opts.model || process.env.SOCIAL_CAPTION_MODEL || "claude-sonnet-5",
    max_tokens: 800,
    system,
    tools: [CREATIVE_TOOL],
    tool_choice: { type: "tool", name: CREATIVE_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source },
          { type: "text", text: "Caption this design for posting, and suggest any improvements. Return via the tool." },
        ],
      },
    ],
  });
  const block = (msg.content || []).find((b) => b.type === "tool_use" && b.name === CREATIVE_TOOL.name);
  if (!block) throw new Error("creative review returned nothing");
  const out = block.input || {};
  return {
    caption: String(out.caption || "").trim(),
    hashtags: Array.isArray(out.hashtags) ? out.hashtags : [],
    suggestions: Array.isArray(out.suggestions) ? out.suggestions.map((s) => String(s).trim()).filter(Boolean) : [],
    verdict: out.verdict === "suggest_changes" ? "suggest_changes" : "ready",
    language: String(out.language || language),
    mentionedItems: Array.isArray(out.mentionedItems) ? out.mentionedItems : [],
    claimedPrices: Array.isArray(out.claimedPrices) ? out.claimedPrices : [],
  };
}

// ------------------------------------------------ Quality Analysis (the safety-net)
// Before a post reaches the owner, verify it actually FULFILS THE REQUEST and FITS THE
// CLIENT (input intent vs output, right business, image attached, caption complete).
// NOT craft (that's the SMM) — this catches mismatches like "travel poster in ->
// restaurant post out". A mismatch -> hold with a plain reason.
const QA_TOOL = {
  name: "qa_check",
  description: "Verify a produced post fulfils the request and fits the client, before it reaches the owner.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["pass", "hold"] },
      fulfilsRequest: { type: "boolean", description: "Does the output actually address what was requested?" },
      fitsClient: { type: "boolean", description: "Is it on-brand and appropriate for THIS client's business (not some other kind of business)?" },
      captionComplete: { type: "boolean", description: "Complete caption — a real CTA, no placeholders/TODOs, correct language?" },
      issues: { type: "array", items: { type: "string" }, description: "Concrete problems found. Empty if none." },
      reason: { type: "string", description: "If 'hold', ONE plain line the owner will understand." },
    },
    required: ["verdict", "reason"],
  },
};

/**
 * QA check: given WHAT WAS REQUESTED (request: {hint,subject,source}) and WHAT WAS
 * PRODUCED (post: {platforms|platform, caption, imageUrl, ...}), return
 * { verdict: pass|hold, fulfilsRequest, fitsClient, captionComplete, issues, reason }.
 * `opts.imageExpected` -> a missing image is a structural hold (no model needed).
 */
async function reviewAsQualityAnalyst(request = {}, post = {}, context = {}, opts = {}) {
  const { facts, profile = {} } = context;
  if (!facts) throw new Error("reviewAsQualityAnalyst needs context.facts");

  // Structural backstop: an image post with no image is a hold, whatever the model says.
  // An image counts as attached if it's hosted (imageUrl) OR carried as a source ref
  // (imageAttached) — under the publish-time-only model it isn't hosted until approved.
  const imagePresent = !!(post.imageUrl || post.imageAttached);
  if (opts.imageExpected && !imagePresent) {
    return { verdict: "hold", fulfilsRequest: false, fitsClient: true, captionComplete: false, issues: ["image not attached"], reason: "this is an image post but no image is attached" };
  }

  const client = opts.client || newClient();
  const business = facts.business || {};
  const system =
    `You are a Quality Analyst with 20 years of experience in social-media agencies. Your ONE job: before a post reaches the business owner, verify it actually FULFILS THE REQUEST and FITS THE CLIENT. You do NOT judge craft (the social media manager does that) — you catch MISMATCHES: the wrong topic, the wrong kind of business, a missing image, an incomplete or placeholder caption, or the wrong language.\n\n` +
    `THE CLIENT is "${business.name}" — ${business.cuisine || business.tagline || "a local business"}. Only content appropriate to THIS business may pass. If the request or the output is about something this business does not do, HOLD it with a plain reason.\n\n` +
    `${factSheet(facts)}`;

  const msg = await client.messages.create({
    model: opts.model || process.env.SOCIAL_CAPTION_MODEL || "claude-sonnet-5",
    max_tokens: 400,
    system,
    tools: [QA_TOOL],
    tool_choice: { type: "tool", name: QA_TOOL.name },
    messages: [
      {
        role: "user",
        content:
          `WHAT WAS REQUESTED:\n- source: ${request.source || "?"}\n- brief/note: ${request.hint || request.subject || "(none)"}\n\n` +
          `WHAT WAS PRODUCED:\n- platforms: ${(post.platforms || []).join(", ") || post.platform || "?"}\n- image attached: ${imagePresent ? "yes" : "NO"}\n- caption: ${post.caption || "(empty)"}\n\n` +
          `Does this fulfil the request AND fit "${business.name}"? Return via the tool.`,
      },
    ],
  });
  const block = (msg.content || []).find((b) => b.type === "tool_use" && b.name === QA_TOOL.name);
  if (!block) throw new Error("QA analyst returned nothing");
  const out = block.input || {};
  return {
    verdict: out.verdict === "hold" ? "hold" : "pass",
    fulfilsRequest: out.fulfilsRequest !== false,
    fitsClient: out.fitsClient !== false,
    captionComplete: out.captionComplete !== false,
    issues: Array.isArray(out.issues) ? out.issues.map((s) => String(s).trim()).filter(Boolean) : [],
    reason: String(out.reason || "").trim(),
  };
}

// ---------------------------------------------------------------- PR Manager
const PR_TOOL = {
  name: "pr_response",
  description: "Return the PR manager's triage + draft reply for a customer review.",
  input_schema: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["routine", "sensitive", "crisis"] },
      reply: { type: "string", description: "A warm, specific owner-voice reply — 2-3 sentences. Empty if it must NOT get a public reply." },
      needsOwner: { type: "boolean", description: "true if the owner must handle it personally." },
      publicReplyOk: { type: "boolean", description: "false for anything alleging illness, injury, discrimination, harassment or a legal threat." },
      reason: { type: "string", description: "Why — especially why the owner is needed, if so." },
    },
    required: ["severity", "reply", "needsOwner", "publicReplyOk", "reason"],
  },
};

async function respondAsPRManager(review, context = {}, opts = {}) {
  const { facts } = context;
  if (!facts) throw new Error("respondAsPRManager needs context.facts");
  const client = opts.client || newClient();

  const system =
    `You are a public relations manager with 20 years of experience handling online reviews and social comments for small businesses. ` +
    `Triage the severity: "routine" (praise or a minor gripe), "sensitive" (angry but an ordinary service issue), "crisis" (alleges illness, injury, discrimination, harassment, or a legal threat).\n\n` +
    `RULES: sound like a real owner, 2-3 sentences, acknowledge specifically, never argue or blame the customer. NEVER invent facts. NEVER offer a refund, free item, discount or compensation — that spends the owner's money, so set needsOwner=true instead. For a CRISIS, write NO public reply (reply empty, publicReplyOk=false, needsOwner=true) and explain why. Never claim certifications or allergen safety.\n\n${factSheet(facts)}`;

  const msg = await client.messages.create({
    model: opts.model || process.env.SOCIAL_REPLY_MODEL || "claude-haiku-4-5",
    max_tokens: 400,
    system,
    tools: [PR_TOOL],
    tool_choice: { type: "tool", name: PR_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Rating: ${review.rating != null ? review.rating + "/5" : "n/a"}\nPlatform: ${review.platform || "google"}\nReview: ${review.text || ""}`,
      },
    ],
  });
  const block = (msg.content || []).find((b) => b.type === "tool_use" && b.name === PR_TOOL.name);
  if (!block) throw new Error("PR Manager did not return a response");
  const out = block.input || {};
  // Enforce the crisis rule structurally, in case the model is inconsistent.
  const crisis = out.severity === "crisis";
  return {
    severity: out.severity || "sensitive",
    reply: crisis ? "" : String(out.reply || "").trim(),
    needsOwner: crisis ? true : !!out.needsOwner,
    publicReplyOk: crisis ? false : !!out.publicReplyOk,
    reason: String(out.reason || "").trim(),
  };
}

module.exports = { reviewAsSocialMediaManager, reviewCreative, reviewAsQualityAnalyst, respondAsPRManager, SMM_TOOL, PR_TOOL, CREATIVE_TOOL, QA_TOOL };
