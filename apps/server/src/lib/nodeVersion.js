// Fail fast with a clear, actionable message when the Node.js runtime is
// too old for this server. The data layer uses Node's built-in
// `node:sqlite` module (see ./sqlite.js), which only exists from Node
// 22.5+ and is stable/flag-free from 22.13+. On older runtimes the import
// of `node:sqlite` dies with a cryptic
//   Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
// which sends people looking for a code bug when the real fix is simply
// upgrading Node.js.
//
// IMPORTANT: this file must stay the FIRST import in src/index.js — ahead
// of anything that (directly or transitively) imports `node:sqlite` —
// because ES module imports are evaluated before the importing module's
// own code runs.

const REQUIRED = [22, 13, 0];

function parseVersion(raw) {
  const m = String(raw).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function satisfies(version) {
  const [a, b, c] = parseVersion(version);
  if (a !== REQUIRED[0]) return a > REQUIRED[0];
  if (b !== REQUIRED[1]) return b > REQUIRED[1];
  return c >= REQUIRED[2];
}

const currentVersion = String(process.versions.node).replace(/^v/, "");

if (!satisfies(process.versions.node)) {
  console.error(
    [
      "",
      `[FATAL] AutoPrint requires Node.js ${REQUIRED.join(".")} or newer, but you are running v${currentVersion}.`,
      "",
      "The server uses Node's built-in `node:sqlite` module, which does not",
      "exist in older Node.js versions (that is the reason for the",
      "'No such built-in module: node:sqlite' crash). This is not a code bug",
      "— the fix is to upgrade Node.js, then re-run the same command.",
      "",
      "How to upgrade (pick one):",
      "  • Download the LTS installer from https://nodejs.org",
      "  • npm install -g n && n 22                 # n version manager",
      "  • nvm install 22 && nvm use 22             # nvm / nvm-windows",
      "",
      `Verify with: node -v   (must print v${REQUIRED.join(".")} or higher)`,
      "",
    ].join("\n")
  );
  process.exit(1);
}
