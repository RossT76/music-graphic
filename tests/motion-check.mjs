// Grades the Dancer's motion. Usage: node tests/motion-check.mjs   (needs Chrome or Chromium)
// Measures, for every lower-body move (with a neutral upper body) and every upper-body move
// (with a neutral lower body), at 120 BPM:
//   beatHit    share of beats on which the body comes to a stop within 50 ms (a "kinematic beat")
//   footSlide  95th-percentile horizontal speed of a planted foot, in body-heights per second
//   comOutside share of planted frames where the centre of mass is outside the feet
//   overReach  share of frames where a foot target was beyond the leg's length
// Exits non-zero if a check fails, so it can guard changes to the dancer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), 'motion-check.html');
const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].find(c => spawnSync(c, ['--version']).status === 0);
if (!CHROME) { console.error('Chrome or Chromium not found'); process.exit(2); }

const run = spawnSync(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
  '--virtual-time-budget=300000', '--dump-dom', 'file://' + page], { encoding: 'utf8', maxBuffer: 1 << 26 });
const match = /<pre id="out">(.*?)<\/pre>/s.exec(run.stdout || '');
if (!match || match[1] === 'running') { console.error('The page produced no results.\n' + (run.stderr || '').slice(0, 500)); process.exit(2); }
let { results, sweep, transitions } = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

// Limits, set a little below what the moves achieve now so a regression shows up.
// (Add a move's name to FLOWING to exempt it from beatHit if it is meant to have no stop on the beat.)
const LIMITS = { beatHit: 0.7, footSlide: 0.05, comOutside: 0.1, overReach: 0.01 };
const FLOWING = new Set();
const pct = x => (100 * x).toFixed(0).padStart(3) + '%';
const failures = [];

console.log('move            part   beatHit  footSlide  comOutside  overReach   BAS');
for (const r of results) {
  const bad = [];
  if (!FLOWING.has(r.name) && r.hit < LIMITS.beatHit) bad.push('beatHit');
  if (r.slide > LIMITS.footSlide) bad.push('footSlide');
  if (r.comOut > LIMITS.comOutside) bad.push('comOutside');
  if (r.over > LIMITS.overReach) bad.push('overReach');
  console.log(`${r.name.padEnd(15)} ${r.part.padEnd(6)} ${pct(r.hit)}     ${r.slide.toFixed(2).padStart(5)}      ${pct(r.comOut)}        ${pct(r.over)}     ${r.bas.toFixed(2)}${bad.length ? '   FAIL: ' + bad.join(', ') : ''}`);
  bad.forEach(b => failures.push(`${r.name}: ${b}`));
}

// The lead that cancels the springs' lag (scale 1) should be about the best of those tried.
const best = sweep.reduce((a, b) => (b.bas > a.bas ? b : a));
const one = sweep.find(s => s.scale === 1);
console.log('\nlead scale  meanBAS  meanBeatHit');
for (const s of sweep) console.log(`   ${s.scale.toFixed(1)}       ${s.bas.toFixed(3)}    ${pct(s.hit)}${s === best ? '  <- best' : ''}`);
if (best.bas - one.bas > 0.03) failures.push(`lead: scale 1 (${one.bas.toFixed(3)}) is well below the best (${best.scale}: ${best.bas.toFixed(3)})`);

// Transitions between lower-body moves: the planted feet must not skate while one stance blends into another.
const TRANSITION = { footSlide: 0.05, comOutside: 0.25, overReach: 0.01 };
const all = transitions;
transitions = transitions.filter(t => t.allowed);   // the choreography never makes the others (it bridges)
const worst = [...transitions].sort((a, b) => b.slide - a.slide);
console.log(`\nlower-body transitions the dancer makes: ${transitions.length} of ${all.length} (the rest are bridged through a grounded move)`);
console.log('worst by foot slide:');
for (const t of worst.slice(0, 5)) console.log(`  ${(t.from + ' -> ' + t.to).padEnd(18)} footSlide ${t.slide.toFixed(2)}   comOutside ${pct(t.comOut)}   overReach ${pct(t.over)}`);
if (process.argv.includes('--all')) for (const t of [...transitions].sort((a, b) => b.comOut - a.comOut)) console.log(`  ${(t.from + ' -> ' + t.to).padEnd(18)} slide ${t.slide.toFixed(2)}  comOutside ${pct(t.comOut)}`);
const slid = transitions.filter(t => t.slide > TRANSITION.footSlide);
const off = transitions.filter(t => t.comOut > TRANSITION.comOutside);
const stretched = transitions.filter(t => t.over > TRANSITION.overReach);
console.log(`transitions over the slide limit: ${slid.length}; off balance: ${off.length}; over-reached: ${stretched.length}`);
if (slid.length) failures.push(`${slid.length} lower-body transitions slide a planted foot (worst: ${worst[0].from} -> ${worst[0].to}, ${worst[0].slide.toFixed(2)})`);
if (off.length) failures.push(`${off.length} lower-body transitions are off balance`);
if (stretched.length) failures.push(`${stretched.length} lower-body transitions over-reach`);

console.log(failures.length ? `\nFAILED (${failures.length}):\n  ` + failures.join('\n  ') : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
