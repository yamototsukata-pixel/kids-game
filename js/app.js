// もじもじ たんけん：アプリ本体
// 1文字の学習の流れ：👀 書き順を見る → ✏️ なぞる → 🖐️ ひとりで書く → ⭐ ことばを聞く
(() => {
  "use strict";

  // ---------- 文字の並び（五十音表。"" は空きマス） ----------
  const LAYOUT = {
    hira: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもや_ゆ_よらりるれろわ_を_ん",
    kata: "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤ_ユ_ヨラリルレロワ_ヲ_ン",
  };
  const TITLE = { hira: "ひらがな", kata: "カタカナ" };

  // 判定のゆるさ（KanjiVG の座標は 109×109）。5歳児向けにかなり甘くしている。
  const TOL_START = 22; // 書きはじめの位置のずれ
  const TOL_END = 26; // 書きおわりの位置のずれ
  const TOL_AVG = 16; // 線全体の平均のずれ
  const SAMPLES = 32;

  const $ = (sel) => document.querySelector(sel);
  const SVG_NS = "http://www.w3.org/2000/svg";

  // ---------- 進み具合の保存（0:まだ 1:なぞれた 2:ひとりで書けた） ----------
  const STORE_KEY = "mojimoji-progress";
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { progress = {}; }
  function saveStar(ch, stars) {
    if ((progress[ch] || 0) >= stars) return;
    progress[ch] = stars;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* 保存できなくても続ける */ }
  }

  // ---------- 読み上げ（ブラウザの音声合成） ----------
  let jaVoice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
    jaVoice = voices.find((v) => v.localService) || voices[0] || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text, { rate = 0.85, onend } = {}) {
    if (!("speechSynthesis" in window)) { if (onend) onend(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (jaVoice) u.voice = jaVoice;
    u.rate = rate;
    u.pitch = 1.1;
    if (onend) u.onend = onend;
    speechSynthesis.speak(u);
  }

  // ---------- 効果音（Web Audio で短い音を鳴らす） ----------
  let audioCtx = null;
  function beep(freqs, dur = 0.12, type = "sine", gain = 0.15) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      let t = audioCtx.currentTime;
      for (const f of freqs) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start(t);
        o.stop(t + dur);
        t += dur * 0.8;
      }
    } catch (e) { /* 音が出せない環境では鳴らさない */ }
  }
  const sfx = {
    good: () => beep([880, 1320], 0.1),
    miss: () => beep([330, 262], 0.14, "triangle", 0.1),
    clear: () => beep([523, 659, 784, 1047], 0.13),
  };

  // ---------- 画面切りかえ ----------
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }

  // ---------- ホーム ----------
  let script = "hira";
  document.querySelectorAll(".big-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      script = btn.dataset.script;
      speak(TITLE[script]);
      openList();
    });
  });

  // ---------- もじ一覧 ----------
  function openList() {
    $("#list-title").textContent = TITLE[script];
    const grid = $("#kana-grid");
    grid.innerHTML = "";
    for (const ch of LAYOUT[script]) {
      const cell = document.createElement("button");
      cell.className = "kana-cell";
      if (ch === "_") {
        cell.classList.add("empty");
        cell.tabIndex = -1;
      } else {
        const stars = progress[ch] || 0;
        cell.textContent = ch;
        cell.setAttribute("aria-label", ch);
        if (stars) {
          cell.classList.add(`done-${stars}`);
          const s = document.createElement("span");
          s.className = "stars";
          s.textContent = "⭐".repeat(stars);
          cell.appendChild(s);
        }
        cell.addEventListener("click", () => openPractice(ch));
      }
      grid.appendChild(cell);
    }
    show("screen-list");
  }
  $("#list-back").addEventListener("click", () => {
    stopAll();
    show("screen-home");
  });

  // ---------- れんしゅう ----------
  const board = $("#board");
  const layers = {
    guide: $("#layer-guide"),
    done: $("#layer-done"),
    anim: $("#layer-anim"),
    ink: $("#layer-ink"),
    hint: $("#layer-hint"),
  };

  let current = null; // 練習中の文字
  let strokes = []; // { d, pts, len }
  let phase = "watch"; // watch / trace / alone / done
  let strokeIndex = 0;
  let busy = false; // アニメーション中は子どもの入力を受けつけない
  let session = 0; // 画面を離れたときに、途中のアニメーションを止めるための番号
  const timers = new Set();

  function wait(ms) {
    return new Promise((resolve) => {
      const id = setTimeout(() => { timers.delete(id); resolve(); }, ms);
      timers.add(id);
    });
  }
  function stopAll() {
    session++;
    timers.forEach(clearTimeout);
    timers.clear();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  function el(name, attrs) {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  // お手本の画を、等間隔の点の列にしておく（判定に使う）。
  function prepareStrokes(ch) {
    return window.STROKES[ch].map((d) => {
      const p = el("path", { d });
      layers.anim.appendChild(p);
      const len = p.getTotalLength();
      const pts = [];
      for (let i = 0; i < SAMPLES; i++) {
        const q = p.getPointAtLength((len * i) / (SAMPLES - 1));
        pts.push({ x: q.x, y: q.y });
      }
      p.remove();
      return { d, pts, len };
    });
  }

  function setStep(name) {
    const order = ["watch", "trace", "alone", "done"];
    const idx = order.indexOf(name);
    document.querySelectorAll(".steps li").forEach((li, i) => {
      li.classList.toggle("current", i === idx);
      li.classList.toggle("passed", i < idx);
    });
  }

  function openPractice(ch) {
    stopAll();
    current = ch;
    $("#screen-practice").classList.toggle("kata", script === "kata");
    show("screen-practice");
    startChar();
  }

  async function startChar() {
    const my = ++session;
    Object.values(layers).forEach(clear);
    $("#words").classList.remove("show");
    $("#after-buttons").classList.remove("show");
    strokes = prepareStrokes(current);
    strokeIndex = 0;

    // 👀 書き順を見る
    phase = "watch";
    setStep("watch");
    busy = true;
    drawGuide(true);
    speak(current);
    await wait(700);
    for (const s of strokes) {
      if (my !== session) return;
      await animateStroke(s, "anim", my);
      await wait(150);
    }
    if (my !== session) return;
    await wait(500);
    clear(layers.anim);

    // ✏️ なぞる
    phase = "trace";
    setStep("trace");
    speak("なぞって みよう");
    busy = false;
    showHint();
  }

  function drawGuide(visible) {
    clear(layers.guide);
    if (!visible) return;
    for (const s of strokes) layers.guide.appendChild(el("path", { d: s.d, class: "stroke guide" }));
  }

  // 1画を、書く速さで少しずつ描くアニメーション。
  function animateStroke(s, cls, my) {
    return new Promise((resolve) => {
      const p = el("path", { d: s.d, class: `stroke ${cls}` });
      p.style.strokeDasharray = s.len;
      p.style.strokeDashoffset = s.len;
      layers.anim.appendChild(p);
      const dur = Math.max(350, s.len * 11);
      const t0 = performance.now();
      const step = (now) => {
        if (my !== session) return resolve();
        const k = Math.min(1, (now - t0) / dur);
        p.style.strokeDashoffset = s.len * (1 - k);
        if (k < 1) requestAnimationFrame(step);
        else resolve(p);
      };
      requestAnimationFrame(step);
    });
  }

  // 次に書く画の「書きはじめ」に、光る丸と番号を出す。
  function showHint() {
    clear(layers.hint);
    const s = strokes[strokeIndex];
    if (!s) return;
    const { x, y } = s.pts[0];
    layers.hint.appendChild(el("circle", { cx: x, cy: y, r: 4.2, class: "hint-dot" }));
    const t = el("text", { x, y, class: "hint-num" });
    t.textContent = strokeIndex + 1;
    layers.hint.appendChild(t);
  }

  // ---------- 子どもが指で書く ----------
  let drawing = null; // { pts, path, id }

  function toBoard(e) {
    const pt = board.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(board.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }
  function pathFromPts(pts) {
    return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  }

  board.addEventListener("pointerdown", (e) => {
    if (busy || (phase !== "trace" && phase !== "alone") || drawing) return;
    e.preventDefault();
    board.setPointerCapture(e.pointerId);
    const p = toBoard(e);
    const path = el("path", { class: "stroke ink", d: pathFromPts([p]) });
    layers.ink.appendChild(path);
    drawing = { pts: [p], path, id: e.pointerId };
  });
  board.addEventListener("pointermove", (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) drawing.pts.push(toBoard(ev));
    drawing.path.setAttribute("d", pathFromPts(drawing.pts));
  });
  const finish = (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const d = drawing;
    drawing = null;
    judgeStroke(d);
  };
  board.addEventListener("pointerup", finish);
  board.addEventListener("pointercancel", finish);

  // ---------- 判定 ----------
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function resample(pts, n) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    if (total === 0) return { pts: Array(n).fill(pts[0]), total };
    const out = [pts[0]];
    const step = total / (n - 1);
    let acc = 0;
    for (let i = 1; i < pts.length && out.length < n; i++) {
      let a = pts[i - 1];
      const b = pts[i];
      let seg = dist(a, b);
      while (acc + seg >= step && out.length < n) {
        const k = (step - acc) / seg;
        const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        out.push(q);
        seg -= step - acc;
        a = q;
        acc = 0;
      }
      acc += seg;
    }
    while (out.length < n) out.push(pts[pts.length - 1]);
    return { pts: out, total };
  }

  function isMatch(userPts, model) {
    const { pts: u, total } = resample(userPts, SAMPLES);
    const m = model.pts;
    // ほんの少し触れただけ（タップ）は、短い点の画でなければ失敗にする。
    if (total < Math.min(6, model.len * 0.4)) return false;
    if (dist(u[0], m[0]) > TOL_START) return false;
    if (dist(u[SAMPLES - 1], m[SAMPLES - 1]) > TOL_END) return false;
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += dist(u[i], m[i]);
    return sum / SAMPLES <= TOL_AVG;
  }

  async function judgeStroke(d) {
    const model = strokes[strokeIndex];
    const my = session;
    if (isMatch(d.pts, model)) {
      // できた画は、お手本のきれいな線に置きかえる。
      d.path.remove();
      layers.done.appendChild(el("path", { d: model.d, class: "stroke done" }));
      sfx.good();
      strokeIndex++;
      if (strokeIndex < strokes.length) {
        showHint();
      } else {
        clear(layers.hint);
        await completePhase(my);
      }
      return;
    }
    // うまくいかなかったときは、×を出さずに、正しい動きをもう一度見せる。
    sfx.miss();
    d.path.classList.add("miss");
    busy = true;
    setTimeout(() => d.path.remove(), 600);
    await wait(250);
    if (my !== session) return;
    const p = await animateStroke(model, "anim", my);
    if (my !== session) return;
    await wait(300);
    if (p) p.remove();
    busy = false;
  }

  async function completePhase(my) {
    busy = true;
    if (phase === "trace") {
      saveStar(current, 1);
      sfx.clear();
      speak("じょうず！ こんどは ひとりで かいて みよう");
      await wait(1600);
      if (my !== session) return;
      clear(layers.done);
      clear(layers.ink);
      drawGuide(false);
      strokeIndex = 0;
      phase = "alone";
      setStep("alone");
      busy = false;
      showHint();
      return;
    }
    // 🖐️ ひとりで書けた → ⭐ ことば
    saveStar(current, 2);
    phase = "done";
    setStep("done");
    sfx.clear();
    celebrate();
    speak(`できたね！ ${current}`);
    showWords();
    $("#after-buttons").classList.add("show");
    busy = false;
  }

  function celebrate() {
    const box = $("#celebrate");
    clear(box);
    const items = ["⭐", "🌟", "🎉", "✨", "🌸"];
    for (let i = 0; i < 14; i++) {
      const s = document.createElement("span");
      s.textContent = items[i % items.length];
      s.style.left = `${Math.random() * 92}%`;
      s.style.animationDelay = `${Math.random() * 0.5}s`;
      box.appendChild(s);
    }
    setTimeout(() => clear(box), 2400);
  }

  // ---------- ことば ----------
  function showWords() {
    const box = $("#words");
    box.innerHTML = "";
    const list = window.WORDS[current] || [];
    for (const [word, emoji] of list) {
      const card = document.createElement("button");
      card.className = "word-card";
      card.setAttribute("aria-label", word);
      const em = document.createElement("span");
      em.className = "word-emoji";
      em.textContent = emoji;
      const tx = document.createElement("span");
      tx.className = "word-text";
      const spans = [...word].map((c) => {
        const s = document.createElement("span");
        s.textContent = c;
        if (c === current) s.classList.add("target");
        tx.appendChild(s);
        return s;
      });
      card.append(em, tx);
      card.addEventListener("click", () => sayWord(word, spans));
      box.appendChild(card);
    }
    if (list.length) box.classList.add("show");
  }

  // 単語を読み上げながら、1文字ずつ光らせる（音のまとまりに気づけるように）。
  async function sayWord(word, spans) {
    const my = session;
    speak(word, { rate: 0.75 });
    for (const s of spans) {
      if (my !== session) return;
      if (s.textContent === " ") continue;
      s.classList.add("lit");
      await wait(320);
      s.classList.remove("lit");
    }
  }

  // ---------- ボタン ----------
  function nextChar() {
    const chars = [...LAYOUT[script]].filter((c) => c !== "_");
    const i = chars.indexOf(current);
    openPractice(chars[(i + 1) % chars.length]);
  }
  $("#practice-back").addEventListener("click", () => { stopAll(); openList(); });
  $("#practice-speak").addEventListener("click", () => speak(current));
  $("#practice-next").addEventListener("click", nextChar);
  $("#btn-next").addEventListener("click", nextChar);
  $("#btn-again").addEventListener("click", () => { stopAll(); startChar(); });

  // スマホでダブルタップによる拡大が起きないようにする。
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
})();
