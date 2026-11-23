(() => {
  'use strict';
  const config = window.PLAYDATES;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (selector) => document.querySelector(selector);
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  };
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const colors = ['#ff5a5f', '#ff9f1c', '#ffd23f', '#5ed27a', '#48c3f0', '#a98bff', '#ff8fc7'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // ---------- Sounds: tiny synths, no files ----------
  const sound = (() => {
    let ctx = null;
    let on = store.get('playdates.sound', true);
    const button = $('#sound');
    const show = () => { button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', on ? 'Sounds on' : 'Sounds off'); };
    show();
    const audio = () => {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    function tone({ type = 'sine', from, to = from, time = .15, gain = .18, delay = 0 }) {
      const a = audio(); if (!a) return;
      const t = a.currentTime + delay;
      const osc = a.createOscillator(), g = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + time);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + time);
      osc.connect(g).connect(a.destination);
      osc.start(t); osc.stop(t + time + 0.02);
    }
    function noise(time = .12, gain = .25) {
      const a = audio(); if (!a) return;
      const buffer = a.createBuffer(1, a.sampleRate * time, a.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
      const src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 900;
      g.gain.value = gain; src.buffer = buffer;
      src.connect(f).connect(g).connect(a.destination); src.start();
    }
    const sounds = {
      pop() { noise(.09, .35); tone({ type: 'triangle', from: 900, to: 300, time: .08, gain: .12 }); },
      boing() { tone({ type: 'sine', from: 180, to: 520, time: .12, gain: .2 }); tone({ type: 'sine', from: 520, to: 260, time: .22, gain: .14, delay: .1 }); },
      blip() { tone({ type: 'triangle', from: 660, to: 880, time: .06, gain: .06 }); },
      tick() { tone({ type: 'square', from: 1200, to: 900, time: .04, gain: .04 }); },
      up() { tone({ type: 'triangle', from: 520, to: 780, time: .1, gain: .12 }); },
      down() { tone({ type: 'triangle', from: 520, to: 340, time: .1, gain: .12 }); },
      giggle() { [0, .09, .18, .27].forEach((d, i) => tone({ type: 'sine', from: 700 + i * 90, to: 950 + i * 90, time: .07, gain: .1, delay: d })); },
      chime() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, time: .45, gain: .14, delay: i * .09 })); },
      toot() { tone({ type: 'sawtooth', from: 392, to: 392, time: .25, gain: .06 }); tone({ type: 'sawtooth', from: 494, to: 494, time: .35, gain: .06, delay: .28 }); },
      whoosh() { noise(.25, .12); },
    };
    button.addEventListener('click', () => { on = !on; store.set('playdates.sound', on); show(); if (on) sounds.boing(); });
    return { play(name) { if (on && sounds[name]) try { sounds[name](); } catch { /* audio unavailable */ } } };
  })();

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-sound]');
    if (el) sound.play(el.dataset.sound);
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---------- Confetti ----------
  const confetti = (() => {
    const canvas = $('#confetti'), c = canvas.getContext('2d');
    let bits = [], running = false;
    const size = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
    addEventListener('resize', size); size();
    function frame() {
      c.clearRect(0, 0, canvas.width, canvas.height);
      const s = devicePixelRatio;
      bits = bits.filter((b) => b.y < innerHeight + 40 && b.life-- > 0);
      for (const b of bits) {
        b.vy += .25; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        c.save(); c.translate(b.x * s, b.y * s); c.rotate(b.r); c.fillStyle = b.color;
        if (b.round) { c.beginPath(); c.arc(0, 0, b.w * s / 2, 0, 7); c.fill(); }
        else c.fillRect(-b.w * s / 2, -b.h * s / 2, b.w * s, b.h * s);
        c.restore();
      }
      if (bits.length) requestAnimationFrame(frame); else { running = false; c.clearRect(0, 0, canvas.width, canvas.height); }
    }
    return function burst(x = innerWidth / 2, y = innerHeight / 3, count = 140) {
      if (reduceMotion) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 4 + Math.random() * 10;
        bits.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 6, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
          w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, round: Math.random() < .3, color: pick(colors), life: 160 + Math.random() * 60 });
      }
      if (!running) { running = true; requestAnimationFrame(frame); }
    };
  })();

  // ---------- Hero: letters, balloons, Pip the critter ----------
  document.querySelectorAll('.bouncy .word').forEach((word) => {
    word.innerHTML = [...word.textContent].map((ch) => `<span class="letter">${esc(ch)}</span>`).join('');
  });
  document.querySelectorAll('.bouncy .letter').forEach((letter) => letter.addEventListener('mouseenter', () => sound.play('tick')));

  const balloons = $('#balloons');
  function balloon() {
    if (document.hidden || balloons.children.length >= 6) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'balloon'; b.tabIndex = -1;
    const color = pick(colors);
    b.style.setProperty('--c', color);
    b.style.left = `${5 + Math.random() * 85}%`;
    const rise = 9 + Math.random() * 7;
    b.style.animationDuration = `${rise}s, ${2.6 + Math.random() * 1.6}s`;
    b.innerHTML = '<span class="skin"></span><span class="string"></span>';
    b.addEventListener('animationend', (e) => { if (e.animationName === 'rise') b.remove(); });
    b.addEventListener('pointerdown', (e) => {
      if (b.classList.contains('popped')) return;
      sound.play('pop');
      const rect = b.getBoundingClientRect(), host = balloons.getBoundingClientRect();
      for (let i = 0; i < 10; i++) {
        const bit = document.createElement('span');
        bit.className = 'pop-bits';
        const a = (i / 10) * Math.PI * 2;
        bit.style.cssText = `left:${rect.left - host.left + 32}px;top:${rect.top - host.top + 36}px;--c:${color};--dx:${Math.cos(a) * 60}px;--dy:${Math.sin(a) * 60}px`;
        balloons.appendChild(bit);
        setTimeout(() => bit.remove(), 650);
      }
      b.style.transform = getComputedStyle(b).transform;
      b.classList.add('popped');
      setTimeout(() => b.remove(), 260);
      e.preventDefault();
    });
    balloons.appendChild(b);
  }
  if (!reduceMotion) { balloon(); setInterval(balloon, 2300); }

  const kite = $('#kite');
  kite.addEventListener('click', () => {
    sound.play('whoosh');
    kite.classList.remove('spin'); void kite.offsetWidth; kite.classList.add('spin');
  });
  kite.addEventListener('animationend', (e) => { if (e.animationName === 'kiteSpin') kite.classList.remove('spin'); });

  const critter = $('#critter');
  const pupils = critter.querySelectorAll('.eye i');
  addEventListener('pointermove', (e) => {
    pupils.forEach((pupil) => {
      const r = pupil.parentElement.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const d = Math.min(6, Math.hypot(dx, dy) / 30), a = Math.atan2(dy, dx);
      pupil.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`;
    });
  }, { passive: true });
  critter.addEventListener('click', () => {
    sound.play('giggle');
    critter.classList.remove('happy'); void critter.offsetWidth; critter.classList.add('happy');
    const r = critter.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top, 40);
  });

  // ---------- Dates ----------
  const tz = config.timeZone;
  const fmt = (options) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...options });
  const weekday = fmt({ weekday: 'short' }), monthDay = fmt({ month: 'short', day: 'numeric' }), dayNum = fmt({ day: 'numeric' }),
    month = fmt({ month: 'short' }), longDate = fmt({ weekday: 'long', month: 'long', day: 'numeric' }), clock = fmt({ hour: 'numeric', minute: '2-digit' });
  function when(event) {
    const start = new Date(event.start), end = new Date(event.end);
    if (event.allDay) return `${longDate.format(start)} · all day`;
    const s = clock.format(start), e = clock.format(end);
    const sameHalf = s.slice(-2) === e.slice(-2);
    return `${longDate.format(start)} · ${sameHalf ? s.slice(0, -3) : s}–${e}`;
  }

  // ---------- Card art, picked from the event's words ----------
  const art = {
    train: { tint: '#8fe1ff', sound: 'toot', svg: `
      <svg viewBox="0 0 400 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <rect width="400" height="170" fill="#8fe1ff"/>
        <path d="M0 150 H400" stroke="#2b2350" stroke-width="6"/>
        <g stroke="#2b2350" stroke-width="4">${[...Array(14)].map((_, i) => `<path d="M${i * 30 + 6} 150 v14"/>`).join('')}</g>
        <g><animateTransform attributeName="transform" type="translate" values="-10 0; 10 0; -10 0" dur="2.4s" repeatCount="indefinite"/>
          <g fill="#fff" stroke="#2b2350" stroke-width="3">
            <circle cx="150" cy="40" r="10"><animate attributeName="cy" values="60;10" dur="1.6s" repeatCount="indefinite"/><animate attributeName="r" values="6;18" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.6s" repeatCount="indefinite"/></circle>
            <circle cx="140" cy="40" r="10"><animate attributeName="cy" values="60;10" dur="1.6s" begin=".8s" repeatCount="indefinite"/><animate attributeName="r" values="6;18" dur="1.6s" begin=".8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.6s" begin=".8s" repeatCount="indefinite"/></circle>
          </g>
          <g stroke="#2b2350" stroke-width="4" stroke-linejoin="round">
            <rect x="136" y="62" width="22" height="30" fill="#2b2350"/>
            <rect x="110" y="88" width="120" height="48" rx="10" fill="#ff5a5f"/>
            <rect x="200" y="60" width="56" height="76" rx="8" fill="#ff5a5f"/>
            <rect x="212" y="72" width="32" height="24" rx="5" fill="#ffd23f"/>
            <path d="M110 136 l-22 12 h22z" fill="#ffd23f"/>
            <rect x="250" y="96" width="80" height="40" rx="8" fill="#5ed27a"/>
            <rect x="330" y="96" width="70" height="40" rx="8" fill="#a98bff"/>
            ${[136, 190, 232, 272, 308, 352, 386].map((x) => `<circle cx="${x}" cy="142" r="11" fill="#fff"/>`).join('')}
          </g>
          <circle cx="282" cy="112" r="7" fill="#ffd23f" stroke="#2b2350" stroke-width="3"/><circle cx="364" cy="112" r="7" fill="#ffd23f" stroke="#2b2350" stroke-width="3"/>
        </g>
        <g fill="#fff">${[[40, 30], [330, 24], [270, 48]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"><animate attributeName="opacity" values="1;.2;1" dur="${1.5 + x % 3}s" repeatCount="indefinite"/></circle>`).join('')}</g>
      </svg>` },
    lights: { tint: '#2b2350', sound: 'chime', svg: `
      <svg viewBox="0 0 400 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="400" height="170" fill="#2b2350"/>
        <g fill="#fff">${[...Array(18)].map((_, i) => `<circle cx="${(i * 71) % 400}" cy="${(i * 37) % 70 + 8}" r="${1 + i % 2}"><animate attributeName="opacity" values="1;.2;1" dur="${2 + i % 3}s" repeatCount="indefinite"/></circle>`).join('')}</g>
        <path d="M-10 40 Q 100 110 200 50 T 410 60" fill="none" stroke="#5ed27a" stroke-width="3"/>
        ${[...Array(11)].map((_, i) => { const x = i * 38 + 4, y = i < 5 ? 40 + Math.sin(i / 4 * Math.PI) * 38 : 50 + Math.sin((i - 5) / 5 * Math.PI) * -18; const c = colors[i % colors.length];
          return `<g><rect x="${x - 3}" y="${y + 2}" width="6" height="7" fill="#5ed27a"/><ellipse cx="${x}" cy="${y + 16}" rx="7" ry="10" fill="${c}" stroke="#2b2350" stroke-width="2"><animate attributeName="opacity" values="1;.35;1" dur="1.2s" begin="${(i % 4) * .3}s" repeatCount="indefinite"/></ellipse></g>`; }).join('')}
        <g stroke="#2b2350" stroke-width="3">
          <path d="M40 170 L80 90 L120 170Z" fill="#2fb65a"/><path d="M280 170 L330 70 L380 170Z" fill="#2fb65a"/>
          ${[[70, 130], [92, 150], [320, 110], [345, 140], [300, 150]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="6" fill="${colors[(i + 2) % colors.length]}"><animate attributeName="r" values="6;8;6" dur="1s" begin="${i * .2}s" repeatCount="indefinite"/></circle>`).join('')}
        </g>
        <path d="M200 170 q 0 -40 -10 -60 h20 q -10 20 -10 60" fill="#ffd23f" stroke="#2b2350" stroke-width="3"/>
      </svg>` },
    splash: { tint: '#48c3f0', sound: 'boing', svg: `
      <svg viewBox="0 0 400 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="400" height="170" fill="#8fe1ff"/>
        ${[0, 1, 2].map((i) => `<path d="M-40 ${80 + i * 30} q 25 -18 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 V170 H-40Z" fill="${['#48c3f0', '#2a9fe0', '#1d7fc0'][i]}" stroke="#2b2350" stroke-width="3"><animateTransform attributeName="transform" type="translate" values="0 0; ${i % 2 ? 30 : -30} 0; 0 0" dur="${3 + i}s" repeatCount="indefinite"/></path>`).join('')}
        <g stroke="#2b2350" stroke-width="3"><circle cx="300" cy="72" r="22" fill="#ffd23f"/><circle cx="300" cy="72" r="9" fill="#8fe1ff"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="2s" repeatCount="indefinite"/></g>
      </svg>` },
    party: { tint: '#ffd23f', sound: 'boing', svg: `
      <svg viewBox="0 0 400 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="400" height="170" fill="#ffd23f"/>
        ${[...Array(16)].map((_, i) => `<rect x="${(i * 53) % 400}" y="${(i * 29) % 160}" width="10" height="5" rx="2" fill="${colors[i % colors.length]}" transform="rotate(${i * 23} ${(i * 53) % 400} ${(i * 29) % 160})"/>`).join('')}
        ${[[120, '#ff5a5f', 0], [200, '#48c3f0', .4], [280, '#5ed27a', .8]].map(([x, c, d]) => `
          <g><animateTransform attributeName="transform" type="translate" values="0 6;0 -8;0 6" dur="2.4s" begin="${d}s" repeatCount="indefinite"/>
          <path d="M${x} 112 q -6 30 4 56" stroke="#2b2350" stroke-width="2" fill="none"/>
          <ellipse cx="${x}" cy="78" rx="30" ry="36" fill="${c}" stroke="#2b2350" stroke-width="4"/>
          <ellipse cx="${x - 10}" cy="64" rx="6" ry="9" fill="#fff" opacity=".7"/></g>`).join('')}
      </svg>` },
  };
  function artFor(event) {
    const text = `${event.title} ${event.description}`.toLowerCase();
    if (/train|railway|choo/.test(text)) return art.train;
    if (/light|lantern|glow|holiday|christmas|santa|diwali|garden/.test(text)) return art.lights;
    if (/swim|pool|splash|beach|water|lake/.test(text)) return art.splash;
    return art.party;
  }

  // ---------- Calendar links ----------
  const stamp = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dayStamp = (date) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
    .filter((p) => p.type !== 'literal').reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const ymd = (date) => { const p = dayStamp(date); return `${p.year}${p.month}${p.day}`; };
  function googleLink(event) {
    const dates = event.allDay ? `${ymd(event.start)}/${ymd(event.end)}` : `${stamp(event.start)}/${stamp(event.end)}`;
    const params = new URLSearchParams({ action: 'TEMPLATE', text: `Playdate: ${event.title}`, dates, details: `${event.description}\n\n${location.href.split('#')[0]}`, location: event.location || '' });
    return `https://calendar.google.com/calendar/render?${params}`;
  }
  function icsFile(event) {
    const line = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
    const timing = event.allDay ? [`DTSTART;VALUE=DATE:${ymd(event.start)}`, `DTEND;VALUE=DATE:${ymd(event.end)}`] : [`DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end)}`];
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Come Play//Playdates//EN', 'BEGIN:VEVENT', `UID:${event.id}@come-play`, `DTSTAMP:${stamp(new Date())}`,
      ...timing, `SUMMARY:${line(`Playdate: ${event.title}`)}`, `LOCATION:${line(event.location)}`, `DESCRIPTION:${line(event.description)}`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${line(`Playdate: ${event.title}`)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url; a.download = `playdate-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function calendarButtons(event) {
    const wrap = document.createElement('div');
    wrap.className = 'add-cal';
    wrap.innerHTML = `<a class="pill" href="${esc(googleLink(event))}" target="_blank" rel="noopener" data-sound="boing">Add to Google Calendar</a>
      <button class="pill" type="button" data-sound="boing">Add to Apple or Outlook</button>`;
    wrap.querySelector('button').addEventListener('click', () => { icsFile(event); toast('Calendar file downloaded. Open it to add the playdate.'); });
    return wrap;
  }

  // ---------- Events ----------
  let events = [];
  const myJoins = store.get('playdates.joined', {});

  async function loadEvents() {
    if (config.scriptUrl) {
      try {
        const response = await fetch(`${config.scriptUrl}?action=events`);
        const body = await response.json();
        if (Array.isArray(body.events) && body.events.length) return body.events;
      } catch { /* fall through to the saved list */ }
    }
    const now = Date.now();
    return config.fallbackEvents.filter((e) => new Date(e.end).getTime() > now)
      .map((e) => ({ ...e, going: [...(e.going || []), ...(myJoins[e.id] ? [myJoins[e.id]] : [])] }));
  }

  const facesFor = (going) => going.slice(0, 6).map((g, i) => {
    let hash = 0; for (const ch of g.nickname) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const initial = (g.nickname.replace(/^the\s+/i, '').trim()[0] || '?').toUpperCase();
    return `<span class="face" style="--c:${colors[hash % colors.length]};animation-delay:${i * .08}s" title="${esc(g.nickname)}">${esc(initial)}</span>`;
  }).join('');
  function goingText(going) {
    if (!going.length) return 'Be the first crew to join!';
    const kids = going.reduce((n, g) => n + (Number(g.kids) || 0), 0);
    const names = going.slice(0, 2).map((g) => g.nickname).join(' and ');
    const others = going.length > 2 ? ` and ${going.length - 2} more` : '';
    return `${names}${others} ${going.length === 1 ? 'is' : 'are'} coming${kids ? ` · ${kids} kid${kids === 1 ? '' : 's'}` : ''}`;
  }

  const icons = {
    clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 1"/></svg>',
    pin: '<svg viewBox="0 0 16 16"><path d="M8 15s5-5 5-8.5A5 5 0 0 0 3 6.5C3 10 8 15 8 15z"/><circle cx="8" cy="6.5" r="1.5"/></svg>',
  };

  function render() {
    const cards = $('#cards');
    if (!events.length) {
      cards.innerHTML = '<p class="empty">No playdates on the calendar right now. Check back soon, or get an email when we add one!</p>';
      return;
    }
    cards.innerHTML = '';
    events.forEach((event, i) => {
      const look = artFor(event);
      const start = new Date(event.start);
      const card = document.createElement('article');
      card.className = 'card';
      card.style.setProperty('--i', i);
      card.style.setProperty('--tint', look.tint === '#2b2350' ? '#a98bff' : look.tint);
      const maps = event.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}` : '';
      card.innerHTML = `
        <div class="date-badge" aria-hidden="true"><small>${esc(weekday.format(start))}</small><strong>${esc(dayNum.format(start))}</strong><small>${esc(month.format(start))}</small></div>
        <div class="card-art">${look.svg}</div>
        <div class="card-body">
          <h3>${esc(event.title)}</h3>
          <ul class="facts">
            <li><span class="ico">${icons.clock}</span><span>${esc(when(event))}</span></li>
            ${event.location ? `<li><span class="ico">${icons.pin}</span><a href="${esc(maps)}" target="_blank" rel="noopener">${esc(event.location)}</a></li>` : ''}
          </ul>
          ${event.description ? `<p class="desc clamped">${esc(event.description)}</p><button class="more" type="button" data-sound="blip">read more</button>` : ''}
          <div class="going"><span class="faces">${facesFor(event.going || [])}</span><span class="going-text">${esc(goingText(event.going || []))}</span></div>
          <div class="card-actions">
            <button class="big-button go join-btn" type="button"><span>${myJoins[event.id] ? 'Going!' : "We're in!"}</span></button>
            <div class="cal-menu"><button class="pill cal-btn" type="button" aria-expanded="false">Add to calendar</button></div>
          </div>
        </div>`;
      const desc = card.querySelector('.desc'), more = card.querySelector('.more');
      if (desc && more) {
        requestAnimationFrame(() => { if (desc.scrollHeight <= desc.clientHeight + 2) more.hidden = true; });
        more.addEventListener('click', () => { const open = desc.classList.toggle('clamped'); more.textContent = open ? 'read more' : 'show less'; });
      }
      card.addEventListener('mouseenter', () => { if (matchMedia('(hover: hover)').matches) sound.play('blip'); });
      card.querySelector('.card-art').addEventListener('click', () => sound.play(look.sound));
      card.querySelector('.join-btn').addEventListener('click', () => openJoin(event));
      const calButton = card.querySelector('.cal-btn'), menu = card.querySelector('.cal-menu');
      calButton.addEventListener('click', () => {
        const existing = menu.querySelector('.cal-options');
        document.querySelectorAll('.cal-options').forEach((m) => { m.remove(); });
        document.querySelectorAll('.cal-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        if (existing) { sound.play('down'); return; }
        sound.play('up');
        const options = calendarButtons(event);
        options.className = 'cal-options';
        menu.appendChild(options);
        calButton.setAttribute('aria-expanded', 'true');
      });
      cards.appendChild(card);
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cal-menu')) {
      document.querySelectorAll('.cal-options').forEach((m) => m.remove());
      document.querySelectorAll('.cal-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
  });

  // ---------- Join dialog ----------
  const dialog = $('#join');
  let current = null, kids = 1;
  const kidsOut = $('#kids-count');
  function setKids(n) {
    kids = Math.max(0, Math.min(10, n));
    kidsOut.textContent = kids;
    kidsOut.classList.remove('bump'); void kidsOut.offsetWidth; kidsOut.classList.add('bump');
  }
  $('#kids-plus').addEventListener('click', () => { sound.play('up'); setKids(kids + 1); });
  $('#kids-minus').addEventListener('click', () => { sound.play('down'); setKids(kids - 1); });

  function openJoin(event) {
    current = event;
    sound.play('whoosh');
    $('#join-event').textContent = event.title;
    $('#join-ask').hidden = false; $('#join-done').hidden = true;
    $('#join-msg').textContent = ''; $('#join-msg').className = 'form-msg';
    $('#join-nickname').value = store.get('playdates.nickname', '');
    $('#join-note').value = '';
    setKids(store.get('playdates.kids', 1));
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    setTimeout(() => $('#join-nickname').focus(), 60);
  }
  const closeJoin = () => { sound.play('down'); dialog.close ? dialog.close() : dialog.removeAttribute('open'); };
  $('#join-close').addEventListener('click', closeJoin);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeJoin(); });

  async function post(body) {
    const response = await fetch(config.scriptUrl, { method: 'POST', body: JSON.stringify(body) }); // text/plain: no CORS preflight
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Something went wrong.');
  }

  $('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = $('#join-nickname').value.trim();
    const msg = $('#join-msg');
    if (!nickname) {
      msg.textContent = 'Add a family nickname so we know who’s coming!'; msg.className = 'form-msg bad';
      sound.play('down'); $('#join-nickname').focus(); return;
    }
    const submit = $('#join-submit');
    submit.disabled = true; submit.querySelector('span').textContent = 'Sending…';
    const entry = { nickname, kids };
    try {
      if (config.scriptUrl) {
        await post({ type: 'join', eventId: current.id, nickname, kids, note: $('#join-note').value.trim(), website: e.target.website.value });
      }
      myJoins[current.id] = entry;
      store.set('playdates.joined', myJoins);
      store.set('playdates.nickname', nickname);
      store.set('playdates.kids', kids);
      current.going = [...(current.going || []).filter((g) => g.nickname !== nickname), entry];
      $('#join-ask').hidden = true; $('#join-done').hidden = false;
      $('#join-cal').replaceChildren(...calendarButtons(current).children);
      sound.play('chime');
      confetti();
      render();
    } catch (error) {
      msg.textContent = error.message || 'Couldn’t send that. Please try again.'; msg.className = 'form-msg bad';
      sound.play('down');
    } finally {
      submit.disabled = false; submit.querySelector('span').textContent = "We're in!";
    }
  });

  // ---------- Subscribe ----------
  (function subscribe() {
    const id = config.calendarId;
    const google = $('#sub-google'), apple = $('#sub-apple'), copy = $('#sub-copy');
    if (!id) {
      [google, apple, copy].forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); $('#sub-hint').hidden = false; }));
      return;
    }
    const ics = `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
    google.href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(id)}`;
    apple.href = ics.replace(/^https:/, 'webcal:');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ics); toast('Calendar link copied!'); }
      catch { toast(ics); }
    });
  })();

  $('#alerts').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#alerts-email').value.trim();
    const msg = $('#alerts-msg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'That email doesn’t look quite right.'; msg.className = 'form-msg bad'; sound.play('down'); return;
    }
    if (!config.scriptUrl) { msg.textContent = 'Email alerts are coming soon!'; msg.className = 'form-msg'; return; }
    const button = e.target.querySelector('.send');
    button.disabled = true;
    try {
      await post({ type: 'alerts', email, website: e.target.website.value });
      msg.textContent = 'You’re on the list! Check your inbox.'; msg.className = 'form-msg';
      e.target.reset();
      sound.play('chime');
      const r = button.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top, 80);
    } catch (error) {
      msg.textContent = error.message; msg.className = 'form-msg bad'; sound.play('down');
    } finally {
      button.disabled = false;
    }
  });

  loadEvents().then((list) => {
    events = list.sort((a, b) => new Date(a.start) - new Date(b.start));
    render();
  });
})();
