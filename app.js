/* 20일 완성 장애인복지 — 앱 로직
   · 100% 클라이언트 사이드, 외부 요청 없음
   · 학습 기록은 localStorage에만 저장 (개인정보 없음)
*/
(function () {
  'use strict';

  var DAYS = Array.isArray(window.STUDY_DATA) ? window.STUDY_DATA : [];
  var KEY = 'welfare20.v1';
  var TARGET_DATE = '2026-12-10'; // 면접 예정일 (표시용)
  var main = document.getElementById('main');
  var player = document.getElementById('player');
  var backBtn = document.getElementById('backBtn');
  var topEyebrow = document.getElementById('topEyebrow');
  var topTitle = document.getElementById('topTitle');
  var ddayChip = document.getElementById('ddayChip');
  var toastEl = document.getElementById('toast');

  /* ---------- 상태 ---------- */
  var state = loadState();

  function baseState() {
    return {
      days: {},
      wrong: {},
      settings: { rate: 1, repeat: false, next: false },
      lastDay: 1
    };
  }

  function loadState() {
    var base = baseState();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var p = JSON.parse(raw);
      return {
        days: p.days && typeof p.days === 'object' ? p.days : {},
        wrong: p.wrong && typeof p.wrong === 'object' ? p.wrong : {},
        settings: Object.assign(base.settings, p.settings || {}),
        lastDay: Number(p.lastDay) || 1
      };
    } catch (e) {
      return base;
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
  }

  /* ---------- 유틸 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function byDay(n) {
    for (var i = 0; i < DAYS.length; i++) if (DAYS[i].day === Number(n)) return DAYS[i];
    return null;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function dayChars(day) {
    var n = 0;
    day.theory.forEach(function (sec) {
      n += sec.heading.length;
      sec.body.forEach(function (b) { n += b.length; });
    });
    return n;
  }

  function estMinutes(day) {
    // 한국어 낭독 대략 분당 380자 (1.0x 기준)
    return Math.max(3, Math.round(dayChars(day) / 380));
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  function doneCount() {
    var c = 0;
    for (var k in state.days) if (state.days[k] && state.days[k].doneAt) c++;
    return c;
  }

  function wrongKeys() { return Object.keys(state.wrong); }

  function avgScore() {
    var total = 0, sum = 0;
    for (var k in state.days) {
      var d = state.days[k];
      if (d && d.doneAt) { total += (d.total || 5); sum += (d.score || 0); }
    }
    return total ? Math.round((sum / total) * 100) : 0;
  }

  function nextDay() {
    for (var i = 1; i <= DAYS.length; i++) {
      if (!state.days[i] || !state.days[i].doneAt) return i;
    }
    return 1;
  }

  function ddayText() {
    var target = new Date(TARGET_DATE + 'T00:00:00+09:00');
    var now = new Date();
    var t0 = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    var n0 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((t0 - n0) / 86400000);
    if (diff < 0) return '';
    if (diff === 0) return 'D-DAY';
    return 'D-' + diff;
  }

  /* ---------- TTS ---------- */
  var pendingAuto = 0;
  var tts = (function () {
    var queue = [];
    var pi = 0;      // 문단(문장 묶음) 인덱스
    var ci = 0;      // 묶음 내 문장 인덱스
    var playing = false;
    var paused = false;
    var gen = 0;
    var dayNum = null;
    var voice = null;
    var currentTotal = 0;

    function supported() {
      return typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
    }

    function pickVoice() {
      if (!supported()) return null;
      var vs = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) {
        if (/^ko([-_]KR)?$/i.test(vs[i].lang) || /^ko/i.test(vs[i].lang)) return vs[i];
      }
      return null;
    }

    if (supported()) {
      voice = pickVoice();
      window.speechSynthesis.onvoiceschanged = function () { voice = pickVoice(); };
    }

    function build(day) {
      var q = [];
      day.theory.forEach(function (sec, s) {
        var h = document.querySelector('.sec[data-s="' + s + '"] .sec-title');
        q.push({ s: s, p: -1, text: sec.heading, el: h });
        sec.body.forEach(function (para, p) {
          var el = document.querySelector('.sec[data-s="' + s + '"] p[data-p="' + p + '"]');
          q.push({ s: s, p: p, text: para, el: el });
        });
      });
      return q;
    }

    function chunks(text) {
      var parts = String(text).split(/(?<=[.!?。])\s+/).filter(Boolean);
      // '1.' 처럼 숫자만 남은 조각은 뒤 문장과 합쳐 읽기 어색함을 막는다
      var merged = [];
      parts.forEach(function (part) {
        var prev = merged[merged.length - 1];
        if (prev && (/^\d+[.)]$/.test(prev) || prev.length < 8)) merged[merged.length - 1] = prev + ' ' + part;
        else merged.push(part);
      });
      var out = [];
      merged.forEach(function (part) {
        if (part.length <= 220) { out.push(part); return; }
        var buf = '';
        part.split(/(?<=[,\u3001])\s*/).forEach(function (seg) {
          if (buf && (buf + seg).length > 220) { out.push(buf); buf = seg; }
          else buf += seg;
        });
        if (buf) out.push(buf);
      });
      return out.length ? out : [String(text)];
    }


    function highlight(el) {
      $$('.is-speaking').forEach(function (n) { n.classList.remove('is-speaking'); });
      if (el) {
        el.classList.add('is-speaking');
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
      }
    }

    function speak() {
      if (!playing || paused) return;
      if (pi >= queue.length) { finish(); return; }
      var item = queue[pi];
      var list = chunks(item.text);
      if (ci >= list.length) { ci = 0; pi++; speak(); return; }

      var u = new SpeechSynthesisUtterance(list[ci]);
      u.lang = 'ko-KR';
      if (voice) u.voice = voice;
      u.rate = clamp(Number(state.settings.rate) || 1, 0.7, 1.6);
      u.pitch = 1;
      var myGen = gen;
      u.onend = function () { if (myGen !== gen) return; ci++; speak(); };
      u.onerror = function (e) {
        if (myGen !== gen) return;
        if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
        ci++; speak();
      };
      highlight(item.el);
      updateUI();
      try { window.speechSynthesis.speak(u); } catch (err) { playing = false; updateUI(); }
    }

    function start(day, startIdx) {
      if (!day) return;
      if (!supported()) { toast('이 브라우저는 음성 읽기를 지원하지 않아요. 이론을 글로 읽어 주세요.'); return; }
      stop(true);
      queue = build(day);
      if (!queue.length) return;
      currentTotal = queue.length;
      dayNum = day.day;
      pi = clamp(startIdx || 0, 0, queue.length - 1);
      ci = 0;
      playing = true;
      paused = false;
      gen++;
      speak();
      updateUI();
    }

    function stop(silent) {
      gen++;
      try { if (supported()) window.speechSynthesis.cancel(); } catch (e) { }
      playing = false;
      paused = false;
      queue = [];
      pi = 0;
      ci = 0;
      dayNum = null;
      highlight(null);
      updateUI();
      if (!silent) { /* 정지 */ }
    }

    function toggle() {
      if (!supported()) { toast('이 브라우저는 음성 읽기를 지원하지 않아요.'); return; }
      if (playing && !paused) {
        try { window.speechSynthesis.pause(); } catch (e) { }
        paused = true;
        updateUI();
        return;
      }
      if (playing && paused) {
        try { window.speechSynthesis.resume(); } catch (e) { }
        paused = false;
        updateUI();
        return;
      }
      var n = Number((location.hash.match(/day\/(\d+)/) || [])[1]) || state.lastDay;
      var day = byDay(n);
      if (day) start(day, 0);
    }

    function jump(delta) {
      if (!playing || !queue.length) return;
      gen++;
      try { window.speechSynthesis.cancel(); } catch (e) { }
      pi = clamp(pi + delta, 0, queue.length - 1);
      ci = 0;
      speak();
    }

    function setRate(rate) {
      state.settings.rate = rate;
      save();
      if (playing && !paused) {
        gen++;
        try { window.speechSynthesis.cancel(); } catch (e) { }
        speak();
      }
      updateUI();
    }

    function finish() {
      var finishedDay = dayNum;
      playing = false;
      paused = false;
      updateUI();
      if (state.settings.repeat && finishedDay) {
        start(byDay(finishedDay), 0);
        toast('이 Day를 다시 재생합니다.');
        return;
      }
      if (state.settings.next && finishedDay && finishedDay < DAYS.length) {
        pendingAuto = finishedDay + 1;
        location.hash = '#/day/' + (finishedDay + 1);
        return;
      }
      toast('이 Day 이론을 끝까지 들었어요.');
    }

    function updateUI() {
      var icon = document.getElementById('ttsPlayIcon');
      var status = document.getElementById('ttsStatus');
      var prog = document.getElementById('ttsProgress');
      if (!icon) return;
      icon.textContent = playing && !paused ? '❚❚' : '▶';
      document.getElementById('ttsPlay').setAttribute('aria-label', playing && !paused ? '일시정지' : '재생');
      if (status) {
        if (playing && !paused) status.textContent = '듣는 중';
        else if (playing && paused) status.textContent = '일시정지';
        else status.textContent = '이론 듣기';
      }
      if (prog) {
        var total = queue.length || currentTotal;
        prog.textContent = (queue.length ? pi + 1 : 0) + ' / ' + total;
      }
    }

    function setDay(day) {
      currentTotal = day ? day.theory.reduce(function (n, s) { return n + 1 + s.body.length; }, 0) : 0;
      updateUI();
    }

    function isPlaying() { return playing; }

    return {
      supported: supported,
      start: start,
      stop: stop,
      toggle: toggle,
      jump: jump,
      setRate: setRate,
      setDay: setDay,
      updateUI: updateUI,
      isPlaying: isPlaying
    };
  })();

  /* ---------- 라우팅 ---------- */
  function route() {
    var raw = location.hash.replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    tts.stop(true);
    player.hidden = true;
    main.classList.remove('has-player');

    if (!DAYS.length) {
      paintShell('오류', '데이터 없음');
      main.innerHTML = '<p class="empty">학습 데이터를 불러오지 못했습니다.</p>';
      return;
    }

    if (parts[0] === 'day') {
      renderDay(Number(parts[1]) || 1);
    } else if (parts[0] === 'quiz') {
      renderQuiz(Number(parts[1]) || 1);
    } else if (parts[0] === 'review') {
      renderReview();
    } else {
      renderHome();
    }
    window.scrollTo(0, 0);
  }

  function paintShell(eyebrow, title, showBack) {
    topEyebrow.textContent = eyebrow;
    topTitle.textContent = title;
    backBtn.hidden = !showBack;
    document.title = title + ' · 20일 완성 장애인복지';
    var dd = ddayText();
    if (dd) { ddayChip.textContent = dd; ddayChip.hidden = false; }
    else ddayChip.hidden = true;
  }

  backBtn.addEventListener('click', function () {
    if (history.length > 1) history.back();
    else location.hash = '#/';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!player.hidden) tts.stop();
  });

  /* ---------- 홈 ---------- */
  function renderHome() {
    paintShell('20일 완성', '장애인복지', false);
    var done = doneCount();
    var pct = Math.round((done / DAYS.length) * 100);
    var avg = avgScore();
    var wc = wrongKeys().length;
    var nd = nextDay();
    var ndDay = byDay(nd);
    var last = byDay(state.lastDay) || ndDay;
    var R = 34, C = 2 * Math.PI * R;
    var offset = C * (1 - pct / 100);

    var cards = DAYS.map(function (d) {
      var rec = state.days[d.day] || {};
      var isDone = !!rec.doneAt;
      var started = (rec.score != null) || rec.readAt;
      var cls = 'day-card' + (isDone ? ' is-done' : '') + (d.day === nd ? ' is-next' : '');
      var meta = isDone
        ? '<span class="pill ok">' + rec.score + '/' + (rec.total || 5) + '</span><span class="score-mini">완료</span>'
        : (started ? '<span class="pill warm">학습 중</span>' : '<span class="pill gray">시작 전</span>');
      return '' +
        '<button class="' + cls + '" type="button" data-day="' + d.day + '">' +
        '<span class="num">DAY ' + d.day + '</span>' +
        '<h3>' + esc(d.title) + '</h3>' +
        '<span class="score-mini">약 ' + estMinutes(d) + '분 · 5문항</span>' +
        '<span class="meta">' + meta + '</span>' +
        '</button>';
    }).join('');

    main.innerHTML = '' +
      '<section class="card hero">' +
        '<h2>' + (done >= DAYS.length ? '20일을 모두 마쳤어요' : 'Day ' + nd + '부터 이어서') + '</h2>' +
        '<p class="lede">' + esc(ndDay.title) + ' — ' + esc(ndDay.subtitle) + '</p>' +
        '<p class="sub">이론 약 ' + estMinutes(ndDay) + '분 · 음성 듣기 · 퀴즈 5문항</p>' +
        '<div class="progress-wrap">' +
          '<div class="ring" aria-hidden="true">' +
            '<svg width="86" height="86" viewBox="0 0 86 86">' +
              '<circle class="ring-track" cx="43" cy="43" r="' + R + '" fill="none" stroke-width="9"></circle>' +
              '<circle class="ring-fill" cx="43" cy="43" r="' + R + '" fill="none" stroke-width="9" ' +
                'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"></circle>' +
            '</svg>' +
            '<div class="ring-label"><b>' + pct + '%</b><small>진도율</small></div>' +
          '</div>' +
          '<div class="stat-row">' +
            '<div class="stat"><b>' + done + '<small>일</small></b><span>완료</span></div>' +
            '<div class="stat"><b>' + avg + '<small>점</small></b><span>평균</span></div>' +
            '<div class="stat"><b>' + wc + '<small>개</small></b><span>오답</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<a class="btn btn-primary btn-wide" href="#/day/' + nd + '">Day ' + nd + ' 이론 보기</a>' +
          '<div class="row">' +
            '<button class="btn" type="button" id="heroListen">이어듣기</button>' +
            '<a class="btn" href="#/quiz/' + nd + '">바로 퀴즈</a>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<div class="section-title"><h2>오답노트</h2><span>' + wc + '문제</span></div>' +
      '<section class="card" style="padding:14px 16px">' +
        '<p style="font-size:13.5px;color:var(--ink-2)">틀린 문제만 모아 다시 풀 수 있어요. 맞히면 오답노트에서 빠집니다.</p>' +
        '<div class="actions"><div class="row">' +
          '<a class="btn ' + (wc ? 'btn-primary' : '') + '" href="#/review" ' + (wc ? '' : 'aria-disabled="true" style="opacity:.55;pointer-events:none"') + '>오답 ' + wc + '문제 풀기</a>' +
          '<button class="btn" type="button" id="resetBtn">진도 초기화</button>' +
        '</div></div>' +
      '</section>' +

      '<div class="section-title"><h2>20일 커리큘럼</h2><span>하루 1Day</span></div>' +
      '<div class="day-grid">' + cards + '</div>' +

      '<div class="footnote">' +
        '<strong>기록은 이 기기 안에만 저장됩니다.</strong> 서버로 보내지 않고, 로그인도 필요 없어요. 인터넷이 끊겨도 열립니다.' +
        '<details><summary>홈 화면에 앱처럼 추가하기</summary><ol>' +
          '<li>사파리 하단의 공유 버튼(□↑)을 누릅니다.</li>' +
          '<li>홈 화면에 추가를 선택합니다.</li>' +
          '<li>홈 화면 아이콘으로 열면 주소창 없이 뜹니다.</li>' +
        '</ol></details>' +
        '<details><summary>음성 듣기 안내</summary><ol>' +
          '<li>이론 화면 아래 재생 버튼을 누르면 문단부터 읽어 줍니다.</li>' +
          '<li>속도는 0.9x·1.0x·1.2x·1.4x에서 고를 수 있어요.</li>' +
          '<li>반복을 켜면 이 Day를 다시, 다음 Day를 켜면 다음 날로 이어집니다.</li>' +
          '<li>아이폰은 화면이 잠기면 음성이 멈출 수 있어요. 운전 중에는 화면을 켜 두거나 차량 블루투스로 들으세요.</li>' +
        '</ol></details>' +
      '</div>';

    main.querySelectorAll('.day-card').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.getAttribute('data-day'));
        state.lastDay = n; save();
        location.hash = '#/day/' + n;
      });
    });

    var listen = document.getElementById('heroListen');
    if (listen) listen.addEventListener('click', function () {
      var n = Number(last.day);
      location.hash = '#/day/' + n;
      pendingAuto = n;
    });

    var reset = document.getElementById('resetBtn');
    if (reset) reset.addEventListener('click', function () {
      if (!window.confirm('학습 기록과 오답노트를 모두 지울까요? 되돌릴 수 없습니다.')) return;
      state = baseState();
      save();
      toast('기록을 지웠어요.');
      renderHome();
    });
  }

  /* ---------- Day 이론 ---------- */
  function renderDay(n) {
    var day = byDay(n);
    if (!day) { location.hash = '#/'; return; }
    state.lastDay = day.day; save();
    paintShell('DAY ' + day.day, day.title, true);
    player.hidden = false;
    main.classList.add('has-player');

    var rec = state.days[day.day] || {};
    var chips = (day.keywords || []).map(function (k) {
      return '<span class="pill">' + esc(k) + '</span>';
    }).join('');

    var secs = day.theory.map(function (sec, s) {
      var table = '';
      if (sec.table) {
        table = '<div class="table-wrap"><table><thead><tr>' +
          sec.table.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          sec.table.rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
          }).join('') +
          '</tbody></table></div>';
      }
      var tip = sec.tip ? '<div class="tip"><strong>실무 팁</strong> · ' + esc(sec.tip) + '</div>' : '';
      var paras = sec.body.map(function (p, i) {
        return '<p data-p="' + i + '">' + esc(p) + '</p>';
      }).join('');
      return '' +
        '<section class="sec" data-s="' + s + '">' +
          '<h3><span class="sec-title">' + esc(sec.heading) + '</span>' +
            '<button class="sec-play" type="button" data-play="' + s + '" aria-label="이 부분부터 듣기">▶</button>' +
          '</h3>' +
          paras + table + tip +
        '</section>';
    }).join('');

    main.innerHTML = '' +
      '<div class="day-head">' +
        '<p class="kicker">DAY ' + day.day + ' · 약 ' + estMinutes(day) + '분</p>' +
        '<h2>' + esc(day.title) + '</h2>' +
        '<p class="sub">' + esc(day.subtitle) + '</p>' +
        '<div class="chips">' + chips + '</div>' +
      '</div>' +

      '<div class="theory">' + secs + '</div>' +

      '<div class="tts-note" id="ttsNote"></div>' +

      '<div class="day-actions">' +
        '<a class="btn btn-primary btn-wide" href="#/quiz/' + day.day + '">' +
          (rec.doneAt ? '퀴즈 다시 풀기 (5문항)' : '퀴즈 풀기 (5문항)') +
        '</a>' +
        '<div class="row">' +
          (day.day > 1 ? '<a class="btn" href="#/day/' + (day.day - 1) + '">‹ Day ' + (day.day - 1) + '</a>' : '<span></span>') +
          (day.day < DAYS.length ? '<a class="btn" href="#/day/' + (day.day + 1) + '">Day ' + (day.day + 1) + ' ›</a>' : '<a class="btn" href="#/">홈으로</a>') +
        '</div>' +
      '</div>';

    // 속도·토글 UI 동기화
    $$('#rateSeg .seg-btn').forEach(function (b) {
      b.classList.toggle('is-on', Number(b.getAttribute('data-rate')) === Number(state.settings.rate));
    });
    document.getElementById('repeatChk').checked = !!state.settings.repeat;
    document.getElementById('nextChk').checked = !!state.settings.next;
    tts.setDay(day);

    var note = document.getElementById('ttsNote');
    if (!tts.supported()) {
      note.textContent = '이 브라우저는 음성 읽기를 지원하지 않습니다. 이론을 글로 읽어 주세요.';
    } else {
      note.textContent = '문단을 듣기 시작하면 현재 문단이 표시됩니다. 속도와 반복은 아래 바에서 바꿀 수 있어요.';
    }

    main.querySelectorAll('.sec-play').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = Number(b.getAttribute('data-play'));
        var idx = 0;
        var acc = 0;
        for (var i = 0; i < day.theory.length; i++) {
          if (i === s) break;
          acc += 1 + day.theory[i].body.length;
        }
        idx = acc;
        tts.start(day, idx);
      });
    });

    if (pendingAuto === day.day) {
      pendingAuto = 0;
      setTimeout(function () { tts.start(day, 0); }, 180);
    }
  }

  /* ---------- 퀴즈 ---------- */
  var session = null;

  function newSession(mode, dayNum) {
    var items = [];
    if (mode === 'review') {
      wrongKeys().forEach(function (k) {
        var parts = k.split('-');
        var d = byDay(parts[0]);
        var qi = Number(parts[1]);
        if (d && d.quiz[qi]) items.push({ day: d.day, qi: qi, q: d.quiz[qi] });
      });
      items.sort(function (a, b) { return a.day - b.day || a.qi - b.qi; });
    } else {
      var day = byDay(dayNum);
      day.quiz.forEach(function (q, i) { items.push({ day: day.day, qi: i, q: q }); });
    }
    return { mode: mode, day: mode === 'review' ? 0 : Number(dayNum), items: items, idx: 0, picks: [], done: false };
  }

  function keyOf(it) { return it.day + '-' + it.qi; }

  function renderQuiz(n) {
    var day = byDay(n);
    if (!day) { location.hash = '#/'; return; }
    paintShell('DAY ' + day.day + ' 퀴즈', '실전 퀴즈', true);
    if (!session || session.mode !== 'day' || session.day !== day.day || session.done) {
      session = newSession('day', day.day);
    }
    paintQuiz();
  }

  function renderReview() {
    paintShell('오답노트', '틀린 문제 다시 풀기', true);
    if (!wrongKeys().length) {
      main.innerHTML = '<div class="empty"><span class="big">🌿</span>오답이 없어요.<br>Day를 풀면 틀린 문제가 여기에 모입니다.</div>' +
        '<div class="actions" style="margin-top:16px"><a class="btn btn-primary btn-wide" href="#/">홈으로</a></div>';
      return;
    }
    if (!session || session.mode !== 'review' || session.done || !session.items.length) {
      session = newSession('review');
    }
    paintQuiz();
  }

  function paintQuiz() {
    if (!session || !session.items.length) { location.hash = '#/'; return; }
    if (session.idx >= session.items.length) { finishQuiz(); return; }
    var it = session.items[session.idx];
    var q = it.q;
    var picked = session.picks[session.idx];

    var dots = session.items.map(function (_, i) {
      var cls = 'dot';
      if (i < session.picks.length && session.picks[i] != null) {
        cls += pickCorrect(i) ? ' is-ok' : ' is-no';
      }
      if (i === session.idx) cls += ' is-now';
      return '<span class="' + cls + '"></span>';
    }).join('');

    var body;
    if (q.type === 'ox') {
      body = '<div class="ox-grid">' +
        '<button class="ox-btn" type="button" data-answer="true">O<span>맞다</span></button>' +
        '<button class="ox-btn" type="button" data-answer="false">X<span>아니다</span></button>' +
        '</div>';
    } else {
      body = '<div class="opt-list">' + q.options.map(function (o, i) {
        return '<button class="opt" type="button" data-answer="' + i + '">' +
          '<span class="idx">' + (i + 1) + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    }

    main.innerHTML = '' +
      '<div class="quiz-top">' +
        '<span class="pill' + (session.mode === 'review' ? ' warm' : '') + '">' +
          (session.mode === 'review' ? '오답노트' : 'DAY ' + session.day) + '</span>' +
        '<div class="dots" aria-hidden="true">' + dots + '</div>' +
        '<span class="score-mini">' + (session.idx + 1) + ' / ' + session.items.length + '</span>' +
      '</div>' +
      '<section class="card q-card">' +
        '<div class="q-type">' +
          '<span class="pill gray">' + (q.type === 'ox' ? 'O / X' : '4지선다') + '</span>' +
          (q.type === 'mc' ? '<span class="score-mini">정답 1개</span>' : '') +
        '</div>' +
        '<p class="q-text">' + esc(q.q) + '</p>' +
        body +
        '<div id="feedback"></div>' +
        '<div class="quiz-foot" id="quizFoot"></div>' +
      '</section>';

    main.querySelectorAll('[data-answer]').forEach(function (b) {
      b.addEventListener('click', function () {
        var raw = b.getAttribute('data-answer');
        var val = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
        answer(val);
      });
    });

    if (picked != null) {
      markAnswered(picked);
    }
  }

  function pickCorrect(i) {
    var it = session.items[i];
    var q = it.q;
    var pick = session.picks[i];
    if (pick == null) return false;
    return pick === q.answer;
  }

  function answer(val) {
    var it = session.items[session.idx];
    if (session.picks[session.idx] != null) return;
    session.picks[session.idx] = val;
    var q = it.q;
    var ok = val === q.answer;
    var key = keyOf(it);

    if (ok) {
      if (state.wrong[key]) { delete state.wrong[key]; }
    } else {
      state.wrong[key] = { at: Date.now() };
    }
    save();
    markAnswered(val);
  }

  function markAnswered(val) {
    var it = session.items[session.idx];
    var q = it.q;
    var ok = val === q.answer;

    var dot = $$('.dots .dot')[session.idx];
    if (dot) {
      dot.classList.remove('is-now');
      dot.classList.add(ok ? 'is-ok' : 'is-no');
    }

    $$('#main [data-answer]').forEach(function (b) {
      var raw = b.getAttribute('data-answer');
      var bv = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
      b.disabled = true;
      if (bv === q.answer) b.classList.add('is-ok');
      else if (bv === val) b.classList.add('is-no');
      else b.classList.add('is-dim');
    });

    var fb = document.getElementById('feedback');
    if (fb) {
      fb.innerHTML = '<div class="feedback ' + (ok ? 'ok' : 'no') + '">' +
        '<div class="verdict">' + (ok ? '✓ 정답입니다' : '✕ 아쉬워요') + '</div>' +
        '<div>' + (ok ? '' : '<b>정답: ' + (q.type === 'ox' ? (q.answer ? 'O' : 'X') : (q.answer + 1) + '번') + '</b> · ') + esc(q.explain) + '</div>' +
        '</div>';
    }

    var foot = document.getElementById('quizFoot');
    if (foot) {
      var last = session.idx === session.items.length - 1;
      foot.innerHTML = '<button class="btn btn-primary" type="button" id="nextQ">' + (last ? '결과 보기' : '다음 문제') + '</button>';
      document.getElementById('nextQ').addEventListener('click', function () {
        session.idx++;
        if (session.idx >= session.items.length) finishQuiz();
        else paintQuiz();
      });
      try { foot.scrollIntoView({ block: 'nearest' }); } catch (e) { }
    }
  }

  function finishQuiz() {
    session.done = true;
    var total = session.items.length;
    var score = 0;
    for (var i = 0; i < total; i++) if (pickCorrect(i)) score++;

    if (session.mode === 'day') {
      var prev = state.days[session.day] || {};
      state.days[session.day] = {
        readAt: prev.readAt || Date.now(),
        doneAt: Date.now(),
        score: score,
        total: total
      };
      save();
    }

    var pct = Math.round((score / total) * 100);
    var msg = pct === 100 ? '완벽해요. 이 Day는 단단히 잡혔습니다.'
      : pct >= 80 ? '좋아요. 틀린 문제만 한 번 더 보면 충분합니다.'
      : pct >= 60 ? '기본은 잡혔어요. 해설을 다시 읽고 넘어가세요.'
      : '이론을 한 번 더 듣고 다시 풀어 보세요.';

    var items = session.items.map(function (it, i) {
      var ok = pickCorrect(i);
      var q = it.q;
      return '<div class="result-item">' +
        '<span class="mark ' + (ok ? 'ok' : 'no') + '">' + (ok ? 'O' : 'X') + '</span>' +
        '<span class="qi">' + (session.mode === 'day' ? (it.qi + 1) : 'D' + it.day + '·' + (it.qi + 1)) + '</span>' +
        '<span><b>' + esc(q.q) + '</b>' + (ok ? '' : '<br><span style="color:var(--ink-3);font-size:12.5px">' + esc(q.explain) + '</span>') + '</span>' +
        '</div>';
    }).join('');

    var nextN = session.mode === 'day' ? session.day + 1 : 0;
    main.innerHTML = '' +
      '<section class="card result-hero">' +
        '<p class="kicker" style="color:var(--primary);font-weight:800;font-size:12px">' +
          (session.mode === 'day' ? 'DAY ' + session.day + ' 결과' : '오답노트 결과') + '</p>' +
        '<p class="score-big">' + score + '<small> / ' + total + '</small></p>' +
        '<p>' + msg + '</p>' +
      '</section>' +
      '<div class="section-title"><h2>문항별 결과</h2><span>' + pct + '점</span></div>' +
      '<div class="result-list">' + items + '</div>' +
      '<div class="day-actions">' +
        (session.mode === 'day'
          ? '<button class="btn btn-primary btn-wide" type="button" id="retryDay">이 Day 다시 풀기</button>' +
            '<div class="row">' +
              '<button class="btn" type="button" id="wrongThisDay">틀린 문제만</button>' +
              (nextN <= DAYS.length ? '<a class="btn" href="#/day/' + nextN + '">Day ' + nextN + ' 이론</a>' : '<a class="btn" href="#/">홈으로</a>') +
            '</div>'
          : '<button class="btn btn-primary btn-wide" type="button" id="retryReview">오답노트 다시 풀기</button>' +
            '<div class="row"><a class="btn" href="#/">홈으로</a><a class="btn" href="#/quiz/1">Day 1 퀴즈</a></div>') +
        '<a class="btn btn-ghost" href="#/">홈으로</a>' +
      '</div>';

    if (session.mode === 'day') {
      document.getElementById('retryDay').addEventListener('click', function () {
        session = newSession('day', session.day);
        paintQuiz();
      });
      document.getElementById('wrongThisDay').addEventListener('click', function () {
        var wrongs = session.items.filter(function (it, i) { return !pickCorrect(i); });
        if (!wrongs.length) { toast('틀린 문제가 없어요.'); return; }
        session = { mode: 'review', day: session.day, items: wrongs, idx: 0, picks: [], done: false };
        paintQuiz();
      });
    } else {
      var r = document.getElementById('retryReview');
      if (r) r.addEventListener('click', function () {
        session = newSession('review');
        if (!session.items.length) { renderReview(); return; }
        paintQuiz();
      });
    }
  }

  /* ---------- 음성 바 이벤트 ---------- */
  document.getElementById('ttsPlay').addEventListener('click', function () { tts.toggle(); });
  document.getElementById('ttsStop').addEventListener('click', function () { tts.stop(); });
  document.getElementById('ttsPrev').addEventListener('click', function () { tts.jump(-1); });
  document.getElementById('ttsNext').addEventListener('click', function () { tts.jump(1); });

  $$('#rateSeg .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = Number(b.getAttribute('data-rate'));
      $$('#rateSeg .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      tts.setRate(r);
    });
  });

  document.getElementById('repeatChk').addEventListener('change', function (e) {
    state.settings.repeat = e.target.checked; save();
  });
  document.getElementById('nextChk').addEventListener('change', function (e) {
    state.settings.next = e.target.checked; save();
  });

  window.addEventListener('hashchange', route);

  /* ---------- 시작 ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { });
    });
  }

  route();
})();
