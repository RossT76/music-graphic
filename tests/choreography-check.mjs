// Checks that the Dancer behaves as if it has a plan. Usage: node tests/choreography-check.mjs
// A made-up 112-beat track (calm, build, drop, peak, breakdown, groove) is played through the dancer and
// its decisions are graded:
//   - every change of move is a lead-in two beats before a phrase (or a reaction to the drop / the start),
//   - the drop is noticed within two beats,
//   - calm passages use only calm moves; the peak uses a high-energy move and no calm ones,
//   - lower-body moves never go straight between one-footed and two-footed,
//   - phrases repeat within a section (a motif is stated again), rather than every phrase being new.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), 'choreography-check.html');
const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].find(c => spawnSync(c, ['--version']).status === 0);
if (!CHROME) { console.error('Chrome or Chromium not found'); process.exit(2); }
const run = spawnSync(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
  '--virtual-time-budget=300000', '--dump-dom', 'file://' + page], { encoding: 'utf8', maxBuffer: 1 << 26 });
const match = /<pre id="out">(.*?)<\/pre>/s.exec(run.stdout || '');
if (!match || match[1] === 'running') { console.error('The page produced no results.\n' + (run.stderr || '').slice(0, 500)); process.exit(2); }
const { sections, log, levels, incompatible } = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

console.log('track: ' + sections.map(s => `${s.name} ${s.from}-${s.to}`).join(' | ') + '\n');
console.log('beat  event   mood    detail');
for (const e of log) {
  const detail = e.kind === 'phrase' ? `${e.lower} + ${e.upper}${e.mirror ? ' (mirrored)' : ''}   [${e.why}]` : '';
  console.log(`${String(e.beat).padStart(4)}  ${e.kind.padEnd(7)} ${String(e.mood).padEnd(7)} ${detail}`);
}

const failures = [];
const phrases = log.filter(e => e.kind === 'phrase');

// 1. Changes happen as planned lead-ins (two beats before the phrase), or at the start / the drop.
for (const e of phrases) if (e.why === 'lead-in' && e.inPhrase !== 6) failures.push(`beat ${e.beat}: a lead-in change started at phrase beat ${e.inPhrase}, not 6`);

// 2. The drop (the first loud beat after the gap, beat 32) is noticed.
const drop = log.find(e => e.kind === 'drop');
if (!drop || drop.beat < 32 || drop.beat > 34) failures.push(`the drop at beat 32 was ${drop ? 'noticed late/early, at beat ' + drop.beat : 'not noticed'}`);

// 3. Calm passages stay calm; the peak is energetic.
const inRange = (e, a, b) => e.beat >= a && e.beat < b;
for (const [a, b, label] of [[6, 16, 'calm'], [70, 80, 'breakdown']])
  for (const e of phrases.filter(e => inRange(e, a, b)))
    if (levels[e.lower] > 0 || levels[e.upper] > 0) failures.push(`beat ${e.beat}: ${e.lower} + ${e.upper} is too lively for the ${label}`);
const peak = phrases.filter(e => inRange(e, 33, 64));
if (!peak.some(e => levels[e.lower] === 2 || levels[e.upper] === 2)) failures.push('the peak never used a high-energy move');
if (peak.some(e => levels[e.lower] === 0 && levels[e.upper] === 0)) failures.push('the peak used a fully calm phrase');

// 4. Motifs repeat: within each section, at least one (lower, upper) pairing appears more than once.
const bySection = [];
for (const e of log) { if (e.kind === 'section') bySection.push([]); else if (e.kind === 'phrase' && bySection.length) bySection[bySection.length - 1].push(e); }
const full = bySection.filter(s => s.length >= 3);
const repeated = full.filter(s => new Set(s.map(e => e.lower + '|' + e.upper)).size < s.length);
console.log(`\nsections with a repeated motif: ${repeated.length} of ${full.length}`);
if (full.length && repeated.length < Math.ceil(full.length * 0.6)) failures.push('too few sections repeat a motif (the choreography looks random)');

// 5. Lower-body moves never jump straight between one-footed and two-footed (it bridges through a grounded move).
for (const t of incompatible) failures.push(`incompatible lower-body change: ${t}`);

console.log(failures.length ? `\nFAILED (${failures.length}):\n  ` + failures.join('\n  ') : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
