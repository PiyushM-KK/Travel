/**
 * pr-runner.js — the Public Relations job. Takes incoming customer reviews /
 * comments, has the PR Manager agent triage + draft a reply, and returns drafts
 * for the OWNER to approve. It NEVER auto-posts a reply — a public reply is a
 * public statement, and the ones that matter most (illness, injury, legal) must
 * never be automated.
 *
 * Reviews arrive from an injected list (the review-fetch transport — Google/FB
 * review APIs — is owner-gated, like Gmail intake). This runner is the safe brain
 * on top of that transport.
 *
 * Two safety layers:
 *   1. The PR agent itself refuses a public reply for a crisis and escalates.
 *   2. Any drafted PUBLIC reply is run through the same fact-check as a post — a
 *      reply that invents a fact or makes a risky claim is downgraded to
 *      needsOwner rather than offered for posting.
 */

const { respondAsPRManager } = require("../engine/review-agents");
const { validatePost } = require("../engine/validate-post");
const { redact } = require("../engine/publish");

function nowIso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

/**
 * Process a batch of reviews into owner-ready drafts.
 *
 * @param reviews  [{ id?, rating, platform, text }]
 * @param context  { facts, profile }
 * @param opts     { client } for the PR agent (injected in tests),
 *                 deliver(drafts) optional, now, runner
 * @returns [{ review, severity, reply, needsOwner, publicReplyOk, reason }]
 */
async function runPRReview(reviews, context = {}, opts = {}) {
  const { facts, profile = {} } = context;
  if (!facts) throw new Error("runPRReview needs context.facts");
  const list = Array.isArray(reviews) ? reviews : [];
  const drafts = [];

  for (const review of list) {
    let res;
    try {
      res = await respondAsPRManager(review, context, opts);
    } catch (e) {
      // An agent failure is escalated, never dropped or auto-answered.
      res = { severity: "sensitive", reply: "", needsOwner: true, publicReplyOk: false, reason: `PR agent error: ${redact(e && e.message)}` };
    }

    // Second safety layer: a PUBLIC reply is validated like any public statement.
    if (res.publicReplyOk && res.reply) {
      const check = validatePost(
        { platform: "facebook", caption: res.reply, hashtags: [], mentionedItems: [], claimedPrices: [] },
        facts,
        profile
      );
      if (!check.ok) {
        res = { ...res, publicReplyOk: false, needsOwner: true, reason: `reply failed fact-check: ${check.errors.join("; ")}` };
      }
    }

    drafts.push({ review, ...res, autoPosted: false });
  }

  if (opts.deliver) {
    try { await opts.deliver(drafts); } catch (e) { /* delivery failure surfaced by return */ }
  }
  return { at: nowIso(opts.now), count: drafts.length, needingOwner: drafts.filter((d) => d.needsOwner).length, drafts };
}

module.exports = { runPRReview };
