/* ============================================================
   KICKS ON DECK — one-shot data-worker deploy (Cloudflare D1)
   ------------------------------------------------------------
   Run from inside the data-worker/ folder:

     npx wrangler login      # one browser click (only if not already logged in)
     node setup.mjs

   It will:
     1. confirm you're logged into Cloudflare (and start login if not)
     2. create the D1 database "kod_data" (or reuse it if it exists)
     3. write its id into wrangler.toml
     4. create the tables from schema.sql
     5. generate + set the EXPORT_TOKEN secret (and print it so you can save it)
     6. deploy the worker
     7. print the worker URL to paste back to Claude
   ============================================================ */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
process.chdir(DIR); // run relative to this file (the data-worker folder)

const DB_NAME = "kod_data";
const TOML = path.join(DIR, "wrangler.toml");

const c = { reset: "\x1b[0m", b: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m" };
const log = (m) => console.log(m);
const step = (n, m) => log(`\n${c.b}${c.green}[${n}]${c.reset} ${c.b}${m}${c.reset}`);
const die = (m) => { log(`\n${c.red}x ${m}${c.reset}`); process.exit(1); };

// Run a shell command; inherit the terminal (for interactive prompts / live output).
const run = (cmd, opts = {}) => spawnSync(cmd, { stdio: "inherit", shell: true, encoding: "utf8", ...opts });
// Run a shell command and capture stdout (stderr still shows live).
const cap = (cmd) => spawnSync(cmd, { stdio: ["ignore", "pipe", "inherit"], shell: true, encoding: "utf8" });

log(`${c.b}Kicks on Deck - data worker setup${c.reset}\n${c.dim}Sets up the Cloudflare D1 database + deploys the capture worker.${c.reset}`);

// 1. Auth check
step(1, "Checking Cloudflare login...");
const who = cap("npx wrangler whoami");
if (who.status !== 0 || /not authenticated|not logged in/i.test((who.stdout || "") + (who.stderr || ""))) {
  log(`${c.yellow}Not logged in - opening Cloudflare login (approve in your browser, then come back)...${c.reset}`);
  const login = run("npx wrangler login");
  if (login.status !== 0) die("Login didn't complete. Run `npx wrangler login` yourself, then re-run `node setup.mjs`.");
} else {
  log(`${c.green}Logged in.${c.reset}`);
}

// 2. Create (or reuse) the D1 database, and get its id
step(2, `Creating the D1 database "${DB_NAME}" (or reusing it)...`);
let dbId = "";
const info = cap(`npx wrangler d1 info ${DB_NAME} --json`);
if (info.status === 0) {
  try { const j = JSON.parse(info.stdout); dbId = j.uuid || j.database_id || ""; } catch {}
  if (dbId) log(`${c.green}Database already exists.${c.reset}`);
}
if (!dbId) {
  const created = cap(`npx wrangler d1 create ${DB_NAME}`);
  const out = (created.stdout || "") + (created.stderr || "");
  const m = out.match(/database_id\s*=\s*"?([0-9a-fA-F-]{36})"?/) || out.match(/\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/);
  if (created.stdout) log(created.stdout);
  dbId = m ? m[1] : "";
  if (!dbId) die("Couldn't read the database id from Wrangler's output. If it printed a `database_id` above, paste it into wrangler.toml manually and re-run.");
  log(`${c.green}Created. id: ${dbId}${c.reset}`);
}

// 3. Write the id into wrangler.toml
step(3, "Writing the database id into wrangler.toml...");
let toml = fs.readFileSync(TOML, "utf8");
if (/database_id\s*=\s*"/.test(toml)) toml = toml.replace(/(database_id\s*=\s*")[^"]*(")/, `$1${dbId}$2`);
else toml += `\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${DB_NAME}"\ndatabase_id = "${dbId}"\n`;
fs.writeFileSync(TOML, toml);
log(`${c.green}wrangler.toml updated.${c.reset}`);

// 4. Create the tables
step(4, "Creating the tables (schema.sql) on the remote database...");
const schema = run(`npx wrangler d1 execute ${DB_NAME} --remote --file=schema.sql -y`);
if (schema.status !== 0) die("Schema step failed. Check the error above and re-run `node setup.mjs`.");
log(`${c.green}Tables ready.${c.reset}`);

// 5. Generate + set the EXPORT_TOKEN secret (non-interactive)
step(5, "Setting the EXPORT_TOKEN secret...");
const token = randomBytes(24).toString("hex");
const sec = spawnSync(`npx wrangler secret put EXPORT_TOKEN`, { input: token + "\n", stdio: ["pipe", "inherit", "inherit"], shell: true, encoding: "utf8" });
if (sec.status !== 0) die("Setting the secret failed. Check the error above and re-run.");
log(`${c.green}Secret set.${c.reset}`);

// 6. Deploy
step(6, "Deploying the worker...");
const dep = cap("npx wrangler deploy");
if (dep.stdout) log(dep.stdout);
if (dep.status !== 0) die("Deploy failed. Check the error above and re-run.");
const urlMatch = (dep.stdout || "").match(/https:\/\/[^\s]*\.workers\.dev/);
const url = urlMatch ? urlMatch[0] : "";

// 7. Done
log(`\n${c.b}${c.green}Done!${c.reset}`);
log(`\n${c.b}Your worker URL:${c.reset}  ${url || "(scroll up - it's the https://...workers.dev line)"}`);
log(`${c.b}Your EXPORT_TOKEN (save this - it downloads your email list):${c.reset}  ${token}`);
log(`\n${c.b}Next:${c.reset} paste the worker URL back to Claude and it'll wire it into the site.`);
log(`${c.dim}Later, your email list is at:  <worker-url>/export.csv?token=${token}${c.reset}`);
