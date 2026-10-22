// `npm run dev:sync` — runs the app like `npm run dev`, and also pulls new commits from GitHub every
// 15 seconds. The browser picks up the changes by itself, so nobody has to run git by hand while testing.
// New packages are installed and the app restarted automatically when package-lock.json changes.
import { execFileSync, spawn } from 'node:child_process';

const INTERVAL = Number(process.env.SYNC_INTERVAL_MS ?? 15_000);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const time = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const say = (msg) => console.log(`\x1b[36m[sync ${time()}]\x1b[0m ${msg}`);

let app = null;
function startApp() {
  app = spawn(npm, ['run', 'dev'], { stdio: 'inherit', env: process.env });
}
function stopApp() {
  return new Promise((resolve) => {
    if (!app || app.exitCode !== null) return resolve();
    app.once('exit', resolve);
    app.kill('SIGINT');
  });
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
say(`Running the app and following "${branch}" on GitHub (checks every ${Math.round(INTERVAL / 1000)} s). Ctrl+C stops both.`);
startApp();

let busy = false;
async function check() {
  if (busy) return;
  busy = true;
  try {
    git('fetch', '-q', 'origin', branch);
    const local = git('rev-parse', 'HEAD');
    const remote = git('rev-parse', `origin/${branch}`);
    if (local === remote || git('merge-base', local, remote) === remote) return;
    const changed = git('diff', '--name-only', local, remote).split('\n');
    try {
      git('merge', '--ff-only', '-q', `origin/${branch}`);
    } catch {
      say('New changes are on GitHub, but this folder has its own edits, so they were not pulled. Run `git status` to see them.');
      return;
    }
    const subjects = git('log', '--format=%s', `${local}..${remote}`).split('\n').filter(Boolean);
    say(`Updated: ${subjects.reverse().join(' · ')}`);
    if (changed.includes('package-lock.json') || changed.includes('package.json')) {
      say('New packages: installing and restarting the app…');
      await stopApp();
      execFileSync(npm, ['install'], { stdio: 'inherit' });
      startApp();
    }
  } catch (err) {
    const first = String(err?.stderr || err?.message || err).split('\n')[0];
    say(`Couldn't check GitHub (${first}). Will try again.`);
  } finally {
    busy = false;
  }
}

const timer = setInterval(check, INTERVAL);
const quit = async () => {
  clearInterval(timer);
  await stopApp();
  process.exit(0);
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
