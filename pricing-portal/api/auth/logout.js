/** GET /api/auth/logout — clear the session cookie and return to the console (which will show sign-in). */
const { clearCookie } = require("../../lib/session");
module.exports = (req, res) => {
  res.statusCode = 302;
  res.setHeader("Set-Cookie", clearCookie());
  res.setHeader("Location", "/");
  res.end();
};
