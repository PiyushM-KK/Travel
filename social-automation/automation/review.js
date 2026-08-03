/**
 * review.js — run the BUG HUNTER + APP SECURITY agents over a git diff, via the
 * Claude API. This is the *automatable* form of the review ritual (AGENTS.md): one
 * command — or a pre-push hook / CI step — reviews whatever changed and prints
 * findings, exiting non-zero when a HIGH/CRITICAL survives so it can GATE a merge.
 *
 *   $env:ANTHROPIC_API_KEY = 'sk-ant-...'
 *   node SociaMedia_Auto/automation/review.js                # review the last commit
 *   node SociaMedia_Auto/automation/review.js --staged       # review staged changes
 *   node SociaMedia_Auto/automation/review.js HEAD~3 HEAD    # review a range
 *
 * Design notes:
 *   - Skips cleanly (exit 0) with NO ANTHROPIC_API_KEY, so a git hook never blocks
 *     on a missing key. The SDK is required lazily so this file imports offline.
 *   - Forced tool use gives structured findings (no prose parsing).
 *   - Model via REVIEW_MODEL (default claude-opus-4-8 — best at finding real bugs;
 *     set REVIEW_MODEL=claude-haiku-4-5 for cheap/fast runs).
 *   - This is a SECOND pair of eyes, not a substitute for tests/run-all.ps1 (the
 *     deterministic gate). Run both.
 */

const { execSync } = require("child_process");
const { redact } = require("../engine/publish");

const MODEL = process.env.REVIEW_MODEL || "claude-opus-4-8";
const MAX_DIFF = 180000; // chars — keep the prompt bounded; split larger changes

const ROLES = [
  {
    name: "Bug Hunter",
    focus:
      "Find REAL bugs: logic errors, edge cases, data loss, idempotency violations, " +
      "race conditions, error-handling gaps, incorrect assumptions, resource leaks. " +
      "No style nitpicks.",
  },
  {
    name: "App Security",
    focus:
      "Find REAL security issues: auth bypass, fail-open defaults, secret leakage " +
      "(logs/errors/argv/responses), injection, SSRF, path traversal, info disclosure, " +
      "DoS/unbounded input. Distinguish exploitable from theoretical.",
  },
];

const FINDINGS_TOOL = {
  name: "report_findings",
  description: "Report verified findings, most-severe first. Empty array if the diff is clean.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["CRITICAL", "HIGH", "MED", "LOW"] },
            file: { type: "string", description: "file path from the diff" },
            line: { type: "string", description: "line or range, best-effort" },
            issue: { type: "string", description: "one-sentence defect" },
            scenario: { type: "string", description: "concrete failure/exploit: inputs/state -> wrong outcome" },
            fix: { type: "string", description: "the suggested fix" },
          },
          required: ["severity", "file", "issue", "scenario", "fix"],
        },
      },
    },
    required: ["findings"],
  },
};

async function reviewRole(client, role, diff) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [FINDINGS_TOOL],
    tool_choice: { type: "tool", name: "report_findings" }, // force structured output
    messages: [
      {
        role: "user",
        content:
          `You are the ${role.name}, a senior reviewer with 20 years' experience, reviewing ONLY the ` +
          `git diff below (added lines start with '+'). ${role.focus}\n\n` +
          `Every finding MUST include a concrete scenario (specific inputs/state -> wrong outcome). ` +
          `Do NOT invent nitpicks — report an empty array if the diff is genuinely clean. ` +
          `Focus on the changed lines, but use surrounding context to judge correctness.\n\n` +
          "```diff\n" + diff + "\n```",
      },
    ],
  });
  const use = (msg.content || []).find((b) => b.type === "tool_use");
  return (use && use.input && Array.isArray(use.input.findings)) ? use.input.findings : [];
}

function resolveRange(args) {
  if (args.includes("--staged")) return "--staged";
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length >= 2) return `${positional[0]} ${positional[1]}`;
  if (positional.length === 1) return positional[0];
  return "HEAD~1 HEAD";
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("review: no ANTHROPIC_API_KEY set — skipping (exit 0). Set it to run the AI review.");
    process.exit(0);
  }
  const range = resolveRange(process.argv.slice(2));
  let diff;
  try {
    diff = execSync(`git diff ${range}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error("review: `git diff` failed — " + redact(String((e && e.message) || e)));
    process.exit(2);
  }
  if (!diff.trim()) { console.log(`review: empty diff for '${range}' — nothing to review.`); process.exit(0); }
  if (diff.length > MAX_DIFF) {
    console.log(`review: diff is ${diff.length} chars — reviewing the first ${MAX_DIFF} (split large changes for full coverage).`);
    diff = diff.slice(0, MAX_DIFF);
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic();
  console.log(`review: ${MODEL} over '${range}' (${diff.length} chars)`);

  let all = [];
  for (const role of ROLES) {
    process.stdout.write(`\n== ${role.name} ==\n`);
    let findings = [];
    try { findings = await reviewRole(client, role, diff); }
    catch (e) { console.error(`  ${role.name} error: ${redact(String((e && e.message) || e))}`); continue; }
    if (!findings.length) { console.log("  (no findings)"); continue; }
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.file}${f.line ? ":" + f.line : ""} — ${f.issue}`);
      console.log(`      scenario: ${f.scenario}`);
      console.log(`      fix:      ${f.fix}`);
    }
    all = all.concat(findings.map((f) => ({ ...f, role: role.name })));
  }

  const blocking = all.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
  console.log(`\n${all.length} finding(s) — ${blocking.length} HIGH/CRITICAL.`);
  if (blocking.length) console.log("Exiting non-zero (a merge gate can key off this).");
  process.exit(blocking.length ? 1 : 0);
}

main().catch((e) => {
  console.error(redact(String((e && e.message) || e)));
  process.exit(2);
});
