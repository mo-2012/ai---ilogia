(function () {
  "use strict";
  var CFG = window.APP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "ilogia_chats_v1";

  var MODES = {
    explain: "اشرح",
    summarize: "لخّص",
    simplify: "بسّط",
    practice: "اختبرني"
  };
  var STARTS = [
    { m: "explain", icon: "i-bulb", t: "اشرح لي درسًا", s: "اكتب اسم الدرس أو الصق نصه" },
    { m: "summarize", icon: "i-file", t: "لخّص لي نصًا", s: "الصق نص المذاكرة أو أرفق ملفًا" },
    { m: "simplify", icon: "i-lines", t: "بسّط لي فكرة صعبة", s: "بلغة سهلة وأمثلة من الحياة" },
    { m: "practice", icon: "i-help", t: "اختبرني", s: "أسئلة تدريبية من مذاكرتك" }
  ];

  var state = { chats: [], current: null, mode: "explain", file: null, busy: false };

  function load() {
    try { state.chats = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { state.chats = []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state.chats)); } catch (e) {}
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cur() { return state.chats.find(function (c) { return c.id === state.current; }); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- عرض النص (Markdown مبسّط وآمن) ----------
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>");
  }
  function md(text) {
    var lines = text.split(/\r?\n/), out = [], list = null, para = [];
    function flushP() { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } }
    function flushL() { if (list) { out.push("</" + list + ">"); list = null; } }
    lines.forEach(function (ln) {
      var ul = ln.match(/^\s*[-*•]\s+(.*)/), ol = ln.match(/^\s*\d+[.)]\s+(.*)/), h = ln.match(/^#{1,4}\s+(.*)/);
      if (ul || ol) {
        flushP();
        var t = ul ? "ul" : "ol";
        if (list !== t) { flushL(); out.push("<" + t + ">"); list = t; }
        out.push("<li>" + inline((ul || ol)[1]) + "</li>");
      } else if (h) {
        flushP(); flushL(); out.push("<p><strong>" + inline(h[1]) + "</strong></p>");
      } else if (!ln.trim()) {
        flushP(); flushL();
      } else {
        flushL(); para.push(ln.trim());
      }
    });
    flushP(); flushL();
    return out.join("");
  }
  // أسئلة التدريب: "س: ... ج: ..." تتحول لبطاقات
  function renderBot(text) {
    var re = /(?:^|\n)\s*(?:\d+[.)]\s*)?س\s*\d*\s*[:：]\s*([\s\S]*?)\n\s*ج\s*\d*\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:\d+[.)]\s*)?س\s*\d*\s*[:：]|$)/g;
    var m, qs = [], first = -1, last = 0;
    while ((m = re.exec(text))) {
      if (first < 0) first = m.index;
      qs.push([m[1].trim(), m[2].trim()]);
      last = re.lastIndex;
    }
    if (qs.length < 2) return md(text);
    var html = first > 0 ? md(text.slice(0, first)) : "";
    qs.forEach(function (q, i) {
      html += '<div class="qa"><p><strong>' + (i + 1) + ". </strong>" + inline(q[0]) +
        "</p><details><summary>أظهر الإجابة</summary>" + md(q[1]) + "</details></div>";
    });
    if (last < text.length) html += md(text.slice(last));
    return html;
  }

  // ---------- الواجهة ----------
  function renderHistory() {
    var box = $("history");
    if (!state.chats.length) { box.innerHTML = '<div class="h-empty">لا توجد محادثات بعد</div>'; return; }
    box.innerHTML = "";
    state.chats.forEach(function (c) {
      var d = document.createElement("div");
      d.className = "h-item" + (c.id === state.current ? " on" : "");
      d.innerHTML = '<button class="open"></button><button class="icon-btn del" aria-label="حذف المحادثة"><svg class="ic"><use href="#i-trash"/></svg></button>';
      var o = d.querySelector(".open");
      o.innerHTML = esc(c.title) + "<small>" + esc(c.subject) + "</small>";
      o.onclick = function () { openChat(c.id); closeSide(); };
      d.querySelector(".del").onclick = function () {
        if (!confirm("حذف هذه المحادثة؟")) return;
        state.chats = state.chats.filter(function (x) { return x.id !== c.id; });
        save();
        if (state.current === c.id) state.current = null;
        renderAll();
      };
      box.appendChild(d);
    });
  }

  function msgEl(m) {
    var d = document.createElement("div");
    var cls = m.role === "user" ? "user" : m.err ? "bot err" : "bot";
    d.className = "msg " + cls;
    var who = m.role === "user" ? "أنت" : "المساعد";
    var body = m.role === "user" ? esc(m.content) : renderBot(m.content);
    if (m.note) body = '<div class="note">' + esc(m.note) + "</div>" + body;
    d.innerHTML = '<div class="who">' + who + '</div><div class="body">' + body + "</div>";
    return d;
  }

  function renderThread() {
    var t = $("thread"), c = cur();
    t.innerHTML = "";
    var inner = document.createElement("div");
    inner.className = "inner";
    if (!c || !c.messages.length) {
      var w = document.createElement("div");
      w.className = "welcome";
      w.innerHTML = "<h1>أهلًا! أنا مساعدك الدراسي</h1><p>اختر المادة ونوع المساعدة، ثم اكتب سؤالك أو الصق نص الدرس.</p>";
      var g = document.createElement("div");
      g.className = "starts";
      STARTS.forEach(function (s) {
        var b = document.createElement("button");
        b.className = "start";
        b.innerHTML = '<svg class="ic"><use href="#' + s.icon + '"/></svg><div><b>' + s.t + "</b><span>" + s.s + "</span></div>";
        b.onclick = function () { setMode(s.m); $("input").focus(); };
        g.appendChild(b);
      });
      w.appendChild(g);
      inner.appendChild(w);
    } else {
      c.messages.forEach(function (m) { inner.appendChild(msgEl(m)); });
    }
    t.appendChild(inner);
    t.scrollTop = t.scrollHeight;
  }

  function renderAll() {
    renderHistory();
    renderThread();
    var c = cur();
    if (c) $("subject").value = c.subject;
  }

  function openChat(id) { state.current = id; renderAll(); }
  function newChat() { state.current = null; renderAll(); $("input").focus(); }

  function setMode(m) {
    state.mode = m;
    Array.prototype.forEach.call($("modes").children, function (b) {
      b.setAttribute("aria-checked", b.dataset.mode === m ? "true" : "false");
    });
  }

  function hint(msg, bad) {
    var h = $("hint");
    h.textContent = msg || "";
    h.className = "hint" + (bad ? " bad" : "");
  }

  function setStatus() {
    var s = $("status");
    if (CFG.API_URL) { s.textContent = "متصل"; s.className = "status live"; }
    else { s.textContent = "وضع تجريبي"; s.className = "status demo"; }
  }

  // القائمة الجانبية (موبايل)
  function openSide() { $("side").classList.add("open"); $("scrim").classList.add("open"); }
  function closeSide() { $("side").classList.remove("open"); $("scrim").classList.remove("open"); }

  // ---------- الإرسال ----------
  function demoReply(mode, text, subject) {
    var short = text.length > 80 ? text.slice(0, 80) + "…" : text;
    var base = {
      explain: "**الشرح (نموذج تجريبي)**\n\n- الفكرة الأساسية: " + short + "\n- نبدأ بالتعريف ثم ننتقل إلى مثال بسيط.\n- بعدها نربطها بما درسته في مادة " + subject + ".",
      summarize: "**الملخص (نموذج تجريبي)**\n\n- النقطة الأولى من النص.\n- النقطة الثانية من النص.\n- الخلاصة: " + short,
      simplify: "**نسخة مبسّطة (نموذج تجريبي)**\n\nتخيّل أن الفكرة مثل قصة قصيرة: " + short,
      practice: "**أسئلة تدريبية (نموذج تجريبي)**\n\n1) س: ما الفكرة الرئيسية في النص؟\nج: " + short + "\n\n2) س: اذكر مثالًا على الفكرة.\nج: هذا مثال توضيحي تجريبي."
    };
    return base[mode];
  }

  function callApi(c, text) {
    var payload = {
      mode: state.mode,
      subject: c.subject,
      messages: c.messages.slice(-12).map(function (m) { return { role: m.role, content: m.content }; })
    };
    return fetch(CFG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || "خطأ في الخادم");
        return j.reply;
      });
    });
  }

  function send(ev) {
    ev.preventDefault();
    if (state.busy) return;
    var input = $("input"), text = input.value.trim();
    if (!text && !state.file) { hint("اكتب سؤالًا أو أرفق ملفًا.", true); return; }
    var full = text;
    if (state.file) full = (text ? text + "\n\n" : "") + "[نص الملف: " + state.file.name + "]\n" + state.file.text;

    var c = cur();
    if (!c) {
      c = { id: uid(), title: (text || state.file.name).slice(0, 40), subject: $("subject").value, messages: [] };
      state.chats.unshift(c);
      state.current = c.id;
    }
    c.subject = $("subject").value;
    c.messages.push({ role: "user", content: (text || "") + (state.file ? "\n📎 " + state.file.name : ""), full: full });
    // نرسل النص الكامل للخادم لكن نعرض الرسالة المختصرة
    var sendMsgs = c.messages.map(function (m) { return { role: m.role, content: m.full || m.content }; });
    input.value = ""; input.style.height = "auto";
    clearFile(); hint("");
    save(); renderAll();

    state.busy = true; $("send").disabled = true;
    var inner = $("thread").querySelector(".inner");
    var typing = document.createElement("div");
    typing.className = "msg bot";
    typing.innerHTML = '<div class="who">المساعد</div><div class="body"><span class="typing"><i></i><i></i><i></i></span></div>';
    inner.appendChild(typing);
    $("thread").scrollTop = $("thread").scrollHeight;

    var p;
    if (CFG.API_URL) {
      p = fetch(CFG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: state.mode, subject: c.subject, messages: sendMsgs.slice(-12) })
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || j.error) throw new Error(j.error || "خطأ في الخادم");
          return { content: j.reply };
        });
      });
    } else {
      p = new Promise(function (res) {
        setTimeout(function () {
          res({ content: demoReply(state.mode, full, c.subject), note: "هذا رد تجريبي. فعّل الاتصال بالذكاء الاصطناعي من ملف config.js." });
        }, 700);
      });
    }
    p.then(function (r) {
      c.messages.push({ role: "assistant", content: r.content, note: r.note });
    }).catch(function (e) {
      c.messages.push({ role: "assistant", content: "تعذّر الحصول على رد: " + e.message, err: true });
    }).then(function () {
      state.busy = false; $("send").disabled = false;
      save(); renderAll(); input.focus();
    });
  }

  // ---------- الملفات ----------
  function clearFile() { state.file = null; $("chipRow").hidden = true; $("file").value = ""; }
  function onFile() {
    var f = $("file").files[0];
    if (!f) return;
    var max = (CFG.MAX_FILE_KB || 200) * 1024;
    if (f.size > max) { hint("الملف كبير. الحد الأقصى " + (CFG.MAX_FILE_KB || 200) + " ك.ب.", true); $("file").value = ""; return; }
    var r = new FileReader();
    r.onload = function () {
      state.file = { name: f.name, text: String(r.result) };
      $("chipName").textContent = f.name;
      $("chipRow").hidden = false;
      hint("");
    };
    r.readAsText(f, "utf-8");
  }

  // ---------- ربط الأحداث ----------
  function init() {
    load(); setStatus();
    $("modes").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-mode]");
      if (b) setMode(b.dataset.mode);
    });
    $("newChat").onclick = function () { newChat(); closeSide(); };
    $("openSide").onclick = openSide;
    $("closeSide").onclick = closeSide;
    $("scrim").onclick = closeSide;
    $("attach").onclick = function () { $("file").click(); };
    $("file").onchange = onFile;
    $("chipRemove").onclick = clearFile;
    $("form").addEventListener("submit", send);
    $("subject").onchange = function () {
      var c = cur(); if (c) { c.subject = this.value; save(); renderHistory(); }
    };
    var inp = $("input");
    inp.addEventListener("input", function () {
      inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 180) + "px";
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSide(); });
    if (state.chats.length) state.current = state.chats[0].id;
    renderAll();
    $("hint").textContent = "";
  }
  init();
})();
