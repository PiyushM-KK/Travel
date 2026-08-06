// REGRESSION (approval parsing): a client replied "B- 9880" to approve card B, but the parser only
// accepted "B 9880" — so the dash made it fall through to INTAKE and it became a junk post that then
// failed to publish. This locks the robust parser: A/B/both + a code separated by space / dash /
// colon / hash / nothing all resolve to the same approval, real words are never mistaken for a
// command, and a mistyped approval is flagged (not turned into a post).
//   node tests/check_parse_decision.js

const path = require("path");
const { parseDecision, looksLikeApprovalAttempt } = require(path.join(__dirname, "..", "automation", "whatsapp.js"));

const fails = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  console.log(`  ${a === e ? "ok" : "FAIL"} - ${label}`);
  if (a !== e) { fails.push(`${label}\n      got:  ${a}\n      want: ${e}`); }
}

const B9880 = { id: "9880", decision: { action: "approve", variant: "B" } };

// --- the incident + every natural way to type "approve card B for 9880" ---
eq(parseDecision("B 9880"), B9880, '"B 9880"');
eq(parseDecision("B9880"), B9880, '"B9880" (no space)');
eq(parseDecision("B-9880"), B9880, '"B-9880" (dash)');
eq(parseDecision("B- 9880"), B9880, '"B- 9880" (dash+space — the exact reply that broke)');
eq(parseDecision("B: 9880"), B9880, '"B: 9880" (colon)');
eq(parseDecision("b 9880"), B9880, '"b 9880" (lowercase)');
eq(parseDecision("  B   9880  "), B9880, 'padded whitespace');

// --- variants ---
eq(parseDecision("A 9880"), { id: "9880", decision: { action: "approve", variant: "A" } }, '"A 9880" → variant A');
eq(parseDecision("both 9880"), { id: "9880", decision: { action: "approve", variant: "both" } }, '"both 9880" → both');
eq(parseDecision("B"), { id: null, decision: { action: "approve", variant: "B" } }, 'bare "B" → single pending');

// --- verbs ---
eq(parseDecision("approve"), { id: null, decision: { action: "approve" } }, 'bare "approve"');
eq(parseDecision("approve 9880"), { id: "9880", decision: { action: "approve" } }, '"approve 9880"');
eq(parseDecision("reject 9880 too pricey"), { id: "9880", decision: { action: "reject", reason: "too pricey" } }, '"reject 9880 <reason>"');
eq(parseDecision("hold 9880"), { id: "9880", decision: { action: "hold", reason: "" } }, '"hold 9880"');

// --- real words / notes must NOT be read as commands (→ null → intake) ---
eq(parseDecision("scene of the hills"), null, '"scene of the hills" is a note, not a variant');
eq(parseDecision("a lovely place to visit"), null, '"a lovely place…" is a note, not variant A');
eq(parseDecision("brilliant sunset shot"), null, '"brilliant…" is not "b"');
eq(parseDecision("approver access"), null, '"approver…" is not "approve"');
eq(parseDecision("no rush on this"), null, '"no rush…" is not a bare reject');

// --- the guard: a mistyped approval (command word + a number) is caught, so it is NOT made a post ---
console.log("\n  -- looksLikeApprovalAttempt --");
const g = (t, want, label) => { const got = looksLikeApprovalAttempt(t); console.log(`  ${got === want ? "ok" : "FAIL"} - ${label}`); if (got !== want) fails.push(label); };
g("B- 9880", true, '"B- 9880" flagged as an approval attempt');
g("approve the 3rd", true, '"approve the 3rd" flagged (has a number)');
g("Kerala backwaters trip", false, 'a normal note is NOT flagged');
g("hello there", false, '"hello there" not flagged (no number)');

if (fails.length) {
  console.error("\nPARSE-DECISION FAIL:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("\nPARSE-DECISION PASS: A/B/both + code parse across all separators; words stay notes; mistyped approvals are flagged, not posted.");
