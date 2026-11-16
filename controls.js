// Controls page (the main address). Shows the display's settings and changes them through the server (serve.py).
// The visual list, the inputs and the "what is it hearing" meters all come from what the display
// reports, so a new visual appears here without touching this file.
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const waiting = $('waiting');   // shown in place of the visual buttons until the list arrives
  const settings = {};   // what the display should be showing (the server's copy)
  const status = {};     // what the display last reported
  let lastStatusAt = 0;
  let serverUp = false;
  let catalogKey = '';
  let devicesKey = '';

  // ---------- Talking to the server ----------
  // Changes are applied here straight away, then sent a moment later (a dragged slider makes many).
  const pending = {};
  let timer = null;

  function change(patch) {
    Object.assign(settings, patch);
    Object.assign(pending, patch);
    render();
    if (!timer) timer = setTimeout(flush, 50);
  }

  async function flush() {
    timer = null;
    const body = JSON.stringify(pending);
    for (const k of Object.keys(pending)) delete pending[k];
    try {
      await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      serverUp = false;
      renderStatus();
    }
  }

  // A slider being dragged ignores the server's echo of its own earlier values, so it doesn't fight the thumb.
  const held = {};
  const touched = {};
  const editing = key => held[key] || Date.now() - (touched[key] || 0) < 600;
  for (const key of ['speed', 'sens', 'gate']) {
    const input = $(key);
    input.addEventListener('pointerdown', () => { held[key] = true; });
    for (const end of ['pointerup', 'pointercancel', 'blur']) input.addEventListener(end, () => { held[key] = false; });
    input.addEventListener('input', () => { touched[key] = Date.now(); });
  }

  const events = new EventSource('/api/events');
  events.onopen = () => { serverUp = true; renderStatus(); };
  events.onerror = () => { serverUp = false; renderStatus(); };
  events.addEventListener('state', e => {
    for (const [key, value] of Object.entries(JSON.parse(e.data))) {
      if (!editing(key) && !Object.hasOwn(pending, key)) settings[key] = value;
    }
    render();
  });
  events.addEventListener('status', e => {
    const { ageMs, ...report } = JSON.parse(e.data);
    Object.assign(status, report);
    lastStatusAt = Date.now() - (ageMs || 0);
    render();
  });
  setInterval(renderStatus, 1000);   // notices when the display stops reporting

  // ---------- Drawing the page ----------
  const catalog = () => status.catalog || [];
  const current = () => {
    const name = String(settings.visual || status.visual || '').toLowerCase();
    return catalog().find(v => v.name.toLowerCase() === name);
  };
  const outputLive = () => Date.now() - lastStatusAt < 3000;

  function render() {
    renderStatus();
    renderTiles();
    renderMotion();
    renderBackground();
    renderSound();
    renderMeters();
    renderDebug();
  }

  function renderStatus() {
    let kind, message;
    if (!serverUp) {
      kind = 'bad';
      message = 'Can’t reach the server';
    } else if (!outputLive()) {
      kind = 'warn';
      message = 'No display running yet. Use “Open display in another tab”.';
    } else if (!status.listening) {
      kind = 'warn';
      message = 'Display open, but not listening to an input yet';
    } else {
      const device = (status.devices || []).find(d => d.id === status.device);
      const tempo = status.locked ? `${status.bpm} BPM` : 'no steady beat';
      kind = 'ok';
      message = `Display live · listening${device ? ' to ' + device.label : ''} · ${tempo}`;
    }
    $('status').className = 'pill ' + kind;
    $('statusText').textContent = message;
    // The button stands out until a display is running, then steps back.
    $('opendisplay').classList.toggle('primary', !(serverUp && outputLive()));
  }

  // ---------- Opening the display ----------
  // One display tab: a second click brings the existing one forward instead of opening another.
  let displayWin = null;
  $('opendisplay').addEventListener('click', e => {
    e.preventDefault();
    $('popupnote').hidden = true;
    if (displayWin && !displayWin.closed) {
      displayWin.focus();
      return;
    }
    displayWin = window.open($('opendisplay').href, 'music-display');
    if (!displayWin) $('popupnote').hidden = false;   // the browser blocked it
  });

  function renderTiles() {
    const key = JSON.stringify(catalog().map(v => v.name));
    const box = $('visuals');
    if (key !== catalogKey) {
      catalogKey = key;
      box.replaceChildren(...catalog().map(v => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.textContent = v.name;
        b.dataset.name = v.name;
        return b;
      }));
      if (!catalog().length) box.replaceChildren(waiting);
    }
    const here = current();
    for (const b of box.querySelectorAll('button')) {
      const on = Boolean(here) && b.dataset.name === here.name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    }
  }
  $('visuals').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) change({ visual: b.dataset.name });
  });

  function renderMotion() {
    const here = current();
    const moves = Boolean(here && here.motion);
    $('motion').classList.toggle('off', !moves);
    $('motionnote').hidden = !(here && !here.motion);
    for (const id of ['speed', 'speedreset', 'reverse', 'auto']) $(id).disabled = !moves;
    for (const b of $('autorow').querySelectorAll('button')) b.disabled = !moves;

    const speed = settings.speed ?? 1;
    if (!editing('speed')) $('speed').value = Math.log2(speed);
    $('speedval').textContent = speed.toFixed(2) + '×';

    const reversed = Boolean(settings.reverse);
    $('reverse').setAttribute('aria-pressed', reversed);
    const hint = moves ? (here.reverseLabel || 'Runs the motion the other way') : '';
    $('reversehint').textContent = hint ? (reversed ? 'On: ' : '') + hint : ' ';

    const auto = Boolean(settings.auto);
    const every = settings.autoEvery || 32;
    $('auto').setAttribute('aria-pressed', auto);
    for (const b of $('autorow').querySelectorAll('button')) b.setAttribute('aria-pressed', Number(b.dataset.beats) === every);
    // About how long that is, from the tempo the display last heard
    const seconds = status.locked && status.bpm ? Math.round(every * 60 / status.bpm) : 0;
    const about = seconds ? ` (about ${seconds} s at ${status.bpm} BPM)` : '';
    $('autohint').textContent = auto
      ? `On: flips every ${every} beats${about}, while music is playing`
      : 'Flips the direction by itself while music is playing';
  }
  $('auto').addEventListener('click', () => change({ auto: !settings.auto, autoEvery: settings.autoEvery || 32 }));
  $('autorow').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) change({ autoEvery: Number(b.dataset.beats) });
  });
  $('speed').addEventListener('input', () => change({ speed: Math.round(2 ** Number($('speed').value) * 100) / 100 }));
  $('speedreset').addEventListener('click', () => change({ speed: 1 }));
  $('reverse').addEventListener('click', () => change({ reverse: !settings.reverse }));

  function renderBackground() {
    for (const b of $('bg').querySelectorAll('button')) {
      const on = b.dataset.bg === (settings.bg || 'black');
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    }
  }
  $('bg').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) change({ bg: b.dataset.bg });
  });

  function renderSound() {
    for (const key of ['sens', 'gate']) {
      const value = settings[key] ?? Number($(key).defaultValue);
      if (!editing(key)) $(key).value = value;
      $(key + 'val').textContent = Math.round(value);
    }
    const select = $('device');
    const devices = status.devices || [];
    const key = JSON.stringify(devices);
    if (key !== devicesKey) {
      devicesKey = key;
      select.replaceChildren(...(devices.length ? devices : [{ id: '', label: 'Waiting for the display…' }]).map(d => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.label;
        return o;
      }));
    }
    select.disabled = !devices.length;
    if (document.activeElement !== select) select.value = settings.device || status.device || '';
  }
  for (const key of ['sens', 'gate']) $(key).addEventListener('input', () => change({ [key]: Number($(key).value) }));
  $('device').addEventListener('change', () => {
    if ($('device').value) change({ device: $('device').value });
  });

  function renderMeters() {
    const live = outputLive();
    const levels = status.levels || [0, 0, 0];
    const values = { level: status.level || 0, bass: levels[0], mid: levels[1], treble: levels[2] };
    for (const [name, v] of Object.entries(values)) $('m-' + name).querySelector('i').style.setProperty('--v', live ? v : 0);
    document.querySelector('.meters').classList.toggle('stale', !live);
  }

  // ---------- Debug ----------
  // The display sends its details only while debug is on. They arrive as sections of [label, text, bar?]
  // rows; the panel is rebuilt only when the set of rows changes, and updated in place otherwise.
  let debugKey = '';
  let debugCells = [];

  function renderDebug() {
    const on = Boolean(settings.debug);
    $('debugtoggle').textContent = on ? 'On' : 'Off';
    $('debugtoggle').setAttribute('aria-pressed', on);
    $('debughelp').hidden = on && Boolean(status.debug);
    $('debugcopy').hidden = !(on && status.debug);
    const body = $('debugbody');
    body.hidden = !on;
    if (!on) {
      debugKey = '';
      return;
    }
    if (!status.debug) {
      body.replaceChildren(Object.assign(document.createElement('p'), {
        className: 'note',
        textContent: outputLive() ? 'Waiting for the first details\u2026' : 'No display running yet, so there is nothing to show.',
      }));
      debugKey = '';
      return;
    }
    const sections = status.debug.sections || [];
    const key = JSON.stringify(sections.map(sec => [sec.title, sec.rows.map(r => [r[0], r.length > 2])]));
    if (key !== debugKey) {
      debugKey = key;
      debugCells = [];
      body.replaceChildren(...sections.map(sec => {
        const box = document.createElement('div');
        box.className = 'dsec';
        const title = document.createElement('h3');
        title.textContent = sec.title;
        box.append(title);
        for (const row of sec.rows) {
          const line = document.createElement('div');
          line.className = 'drow';
          const k = Object.assign(document.createElement('span'), { className: 'k', textContent: row[0] });
          const v = Object.assign(document.createElement('span'), { className: 'v' });
          const b = Object.assign(document.createElement('span'), { className: 'b' });
          b.hidden = row.length < 3;
          line.append(k, v, b);
          box.append(line);
          debugCells.push({ v, b });
        }
        return box;
      }));
    }
    let i = 0;
    for (const sec of sections) {
      for (const row of sec.rows) {
        const cell = debugCells[i++];
        cell.v.textContent = row[1];
        if (row.length > 2) cell.b.style.setProperty('--v', Math.max(0, Math.min(1, row[2])));
      }
    }
    body.classList.toggle('stale', !outputLive());   // dimmed when the display has stopped reporting
  }
  $('debugtoggle').addEventListener('click', () => change({ debug: !settings.debug }));

  // A plain-text copy of what is showing, for pasting into a bug report or a chat.
  $('debugcopy').addEventListener('click', async () => {
    const lines = [`Music Reactive Display debug, ${new Date().toISOString()}`];
    for (const sec of (status.debug && status.debug.sections) || []) {
      lines.push('', sec.title);
      for (const row of sec.rows) lines.push(`  ${row[0]}: ${row[1]}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      $('debugcopy').textContent = 'Copied!';
      setTimeout(() => { $('debugcopy').textContent = 'Copy details'; }, 1500);
    } catch (e) {
      $('debugcopy').textContent = 'Copy blocked';   // the browser refused clipboard access
    }
  });

  // ---------- The address to give OBS ----------
  const url = location.origin + '/display.html?output';
  $('obsurl').value = url;
  $('obsurl').addEventListener('focus', () => $('obsurl').select());
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      $('copy').textContent = 'Copied!';
      setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
    } catch (e) {
      $('obsurl').select();   // clipboard blocked: leave it selected so Ctrl+C works
    }
  });

  render();
})();
