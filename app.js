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
  var SERVICE_LINKS = {
    "ilogia-eg.com": { name: "الموقع الرئيسي", href: "https://ilogia-eg.com/" },
    "app.ilogia-eg.com": { name: "التطبيق الرئيسي", href: "https://app.ilogia-eg.com/" },
    "ai.ilogia-eg.com": { name: "مساعد ilogia الذكي", href: "https://ai.ilogia-eg.com/" },
    "arena.ilogia-eg.com": { name: "ساحة المنافسة", href: "https://arena.ilogia-eg.com/" },
    "dashboard.ilogia-eg.com": { name: "لوحة تحكم الإدارة", href: "https://dashboard.ilogia-eg.com/" },
    "teacher.ilogia-eg.com": { name: "لوحة تحكم المدرس", href: "https://teacher.ilogia-eg.com/" },
    "exams.ilogia-eg.com": { name: "الاختبارات والامتحانات", href: "https://exams.ilogia-eg.com/" },
    "cards.ilogia-eg.com": { name: "البطاقات التعليمية", href: "https://cards.ilogia-eg.com/" },
    "planner.ilogia-eg.com": { name: "المخطط الدراسي", href: "https://planner.ilogia-eg.com/" },
    "library.ilogia-eg.com": { name: "المكتبة التعليمية", href: "https://library.ilogia-eg.com/" },
    "verify.ilogia-eg.com": { name: "التحقق من الشهادات", href: "https://verify.ilogia-eg.com/" },
    "api.ilogia-eg.com": { name: "واجهة API", href: "https://api.ilogia-eg.com/" }
  };
  var STARTS = [
    { m: "explain", icon: "i-bulb", t: "اشرح لي درسًا", s: "اكتب اسم الدرس أو الصق نصه" },
    { m: "summarize", icon: "i-file", t: "لخّص لي نصًا", s: "الصق نص المذاكرة أو أرفق ملفًا" },
    { m: "simplify", icon: "i-lines", t: "بسّط لي فكرة صعبة", s: "بلغة سهلة وأمثلة من الحياة" },
    { m: "practice", icon: "i-help", t: "اختبرني", s: "أسئلة تدريبية من مذاكرتك" }
  ];

  var state = { chats: [], current: null, mode: "explain", file: null, busy: false };
  var chatsLoaded = false;
  var AUTH_KEY = "ilogia_session_v1", authSession = null, authMode = "signin";
  var SB_URL = (CFG.SUPABASE_URL || "").replace(/\/$/, "");
  var authReady = Promise.resolve();
  var cloudChatsReady = false, cloudLoadGeneration = 0;
  var cloudWriteQueue = Promise.resolve();

  function load() {
    var userId = authSession && authSession.user && authSession.user.id;
    var key = userId ? KEY + ":" + userId : KEY;
    try { state.chats = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { state.chats = []; }
    chatsLoaded = true;
  }
  function save(touchCurrent) {
    if (!chatsLoaded) return;
    var current = cur();
    if (touchCurrent !== false) {
      if (current) current.updatedAt = Date.now();
    }
    var userId = authSession && authSession.user && authSession.user.id;
    var key = userId ? KEY + ":" + userId : KEY;
    try { localStorage.setItem(key, JSON.stringify(state.chats)); } catch (e) {}
    if (touchCurrent !== false && userId && cloudChatsReady && current) queueCloudRows(userId, [current]);
  }
  function loadCurrentAccountChats() {
    cloudChatsReady = false;
    cloudLoadGeneration++;
    var userId = authSession && authSession.user && authSession.user.id;
    var anonymousChats = [];
    if (userId) {
      try { anonymousChats = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { anonymousChats = []; }
      if (!Array.isArray(anonymousChats)) anonymousChats = [];
    }
    load();
    if (userId) {
      var knownIds = new Set(state.chats.map(function (chat) { return chat.id; }));
      anonymousChats.forEach(function (chat) {
        if (chat && chat.id && !knownIds.has(chat.id)) {
          state.chats.push(chat);
          knownIds.add(chat.id);
        }
      });
      save(false);
    }
    state.current = state.chats.length ? state.chats[0].id : null;
    renderAll();
    if (userId) loadAccountChatsFromCloud(userId, cloudLoadGeneration);
  }
  function cloudRequest(path, method, body, token) {
    var headers = { apikey: CFG.SUPABASE_KEY, Authorization: "Bearer " + token };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method === "POST") headers.Prefer = "resolution=merge-duplicates,return=minimal";
    return fetch(SB_URL + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (response) {
      if (response.ok) return;
      return response.json().catch(function () { return {}; }).then(function (data) {
        throw new Error(cloudErrorMessage(data, "تعذّر مزامنة المحادثات مع قاعدة البيانات (HTTP " + response.status + ")."));
      });
    });
  }
  function cloudErrorMessage(data, fallback) {
    return data.message || data.msg || (data.error && data.error.message) ||
      data.details || data.hint || data.error_description || fallback;
  }
  function queueCloudOperation(userId, operation) {
    var tokenPromise = getAccessToken();
    cloudWriteQueue = cloudWriteQueue.then(function () {
      return tokenPromise.then(function (token) {
        if (!token || !authSession || !authSession.user || authSession.user.id !== userId) return;
        return operation(token);
      });
    }).catch(function (error) {
      console.error("Chat sync failed:", error);
      if (authSession && authSession.user && authSession.user.id === userId) {
        hint("تعذّرت مزامنة المحادثات: " + error.message, true);
      }
    });
    return cloudWriteQueue;
  }
  function chatRow(chat, userId) {
    var updatedAt = Number(chat.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) updatedAt = Date.now();
    return {
      user_id: userId,
      id: chat.id,
      title: chat.title,
      subject: chat.subject,
      messages: chat.messages,
      updated_at: new Date(updatedAt).toISOString()
    };
  }
  function queueCloudRows(userId, chats) {
    if (!authSession || !authSession.user || authSession.user.id !== userId || !cloudChatsReady) return cloudWriteQueue;
    var rows = chats.map(function (chat) { return chatRow(chat, userId); });
    if (!rows.length) return cloudWriteQueue;
    return queueCloudOperation(userId, function (token) {
      return rows.reduce(function (pending, row) {
        return pending.then(function () {
          return cloudRequest("/rest/v1/chat_conversations?on_conflict=user_id,id", "POST", [row], token);
        });
      }, Promise.resolve());
    });
  }
  function flushCloudSave() {
    return cloudWriteQueue;
  }
  function deleteCloudChat(userId, chatId) {
    if (!userId || !cloudChatsReady) return;
    var params = new URLSearchParams({ user_id: "eq." + userId, id: "eq." + chatId });
    queueCloudOperation(userId, function (token) {
      return cloudRequest("/rest/v1/chat_conversations?" + params.toString(), "DELETE", undefined, token);
    });
  }
  function loadAccountChatsFromCloud(userId, generation) {
    getAccessToken().then(function (token) {
      if (!token) throw new Error("انتهت جلسة الدخول. سجّل الدخول مجددًا لمزامنة المحادثات.");
      var params = new URLSearchParams({
        select: "id,title,subject,messages,updated_at",
        user_id: "eq." + userId,
        order: "updated_at.desc"
      });
      return fetch(SB_URL + "/rest/v1/chat_conversations?" + params.toString(), {
        headers: { apikey: CFG.SUPABASE_KEY, Authorization: "Bearer " + token },
        cache: "no-store"
      }).then(function (response) {
        if (!response.ok) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            throw new Error(cloudErrorMessage(data, "تعذّر تحميل المحادثات من قاعدة البيانات (HTTP " + response.status + ")."));
          });
        }
        return response.json();
      });
    }).then(function (rows) {
      if (generation !== cloudLoadGeneration || !authSession || !authSession.user || authSession.user.id !== userId) return;
      var merged = {};
      var chatsToUpload = [];
      rows.forEach(function (row) {
        if (!row || typeof row.id !== "string" || !Array.isArray(row.messages)) return;
        merged[row.id] = {
          id: row.id,
          title: row.title || "",
          subject: row.subject || "عام",
          messages: row.messages,
          updatedAt: Date.parse(row.updated_at) || 0
        };
      });
      state.chats.forEach(function (chat) {
        var local = Object.assign({}, chat, { updatedAt: Number(chat.updatedAt) || 0 });
        if (!merged[local.id] || local.updatedAt > merged[local.id].updatedAt) {
          merged[local.id] = local;
          chatsToUpload.push(local);
        }
      });
      var currentId = state.current;
      state.chats = Object.keys(merged).map(function (id) { return merged[id]; })
        .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      state.current = state.chats.some(function (chat) { return chat.id === currentId; })
        ? currentId
        : state.chats.length ? state.chats[0].id : null;
      cloudChatsReady = true;
      save(false);
      renderAll();
      if (chatsToUpload.length) {
        hint("");
        queueCloudRows(userId, chatsToUpload);
      } else if (!state.chats.length) {
        hint("لا توجد محادثات محفوظة لهذا الحساب بعد. المحادثات القديمة على جهاز آخر تحتاج فتح الموقع عليه وتسجيل الدخول مرة واحدة لرفعها.", true);
      } else {
        hint("");
      }
    }).catch(function (error) {
      if (generation !== cloudLoadGeneration || !authSession || !authSession.user || authSession.user.id !== userId) return;
      console.error("Chat history load failed:", error);
      hint("تعذّر تحميل المحادثات: " + error.message, true);
    });
  }
  function authRequest(path, body, token) {
    var headers = { "Content-Type": "application/json", apikey: CFG.SUPABASE_KEY };
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(SB_URL + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {})
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var message = data.msg || data.message || (data.error && data.error.message) || data.error_description;
          throw new Error(message || "تعذّر إكمال طلب الحساب.");
        }
        return data;
      });
    });
  }
  function saveAuthSession(data) {
    if (!data || !data.access_token) return false;
    var previousUserId = authSession && authSession.user && authSession.user.id;
    var nextUserId = data.user && data.user.id;
    var accountChanged = previousUserId !== nextUserId && !!nextUserId;
    if (accountChanged) save();
    authSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || (authSession && authSession.refresh_token),
      expires_at: Math.floor(Date.now() / 1000) + (parseInt(data.expires_in, 10) || 3600),
      user: data.user || (authSession && authSession.user) || null
    };
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(authSession)); } catch (e) {}
    renderAccount();
    if (accountChanged && chatsLoaded) loadCurrentAccountChats();
    return true;
  }
  function clearAuthSession() {
    var hadAccount = !!(authSession && authSession.user && authSession.user.id);
    if (hadAccount) save();
    authSession = null;
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
    renderAccount();
    if (hadAccount && chatsLoaded) loadCurrentAccountChats();
  }
  function refreshAuthSession() {
    if (!authSession) return Promise.resolve(null);
    if (!authSession.refresh_token) {
      clearAuthSession();
      return Promise.resolve(null);
    }
    return authRequest("/auth/v1/token?grant_type=refresh_token", { refresh_token: authSession.refresh_token })
      .then(function (data) {
        saveAuthSession(data);
        return authSession && authSession.access_token;
      }).catch(function (error) {
        clearAuthSession();
        throw error;
      });
  }
  function restoreAuthSession() {
    try { authSession = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch (e) { authSession = null; }
    if (!authSession || !authSession.access_token) {
      authSession = null;
      renderAccount();
      return Promise.resolve();
    }
    renderAccount();
    if (!authSession.expires_at || authSession.expires_at < Math.floor(Date.now() / 1000) + 60) {
      return refreshAuthSession().catch(function (error) {
        hint("انتهت جلسة الدخول. سجّل الدخول مجددًا لربط تقدمك.", true);
        console.error("Session refresh failed:", error);
      });
    }
    return Promise.resolve();
  }
  function getAccessToken() {
    if (!authSession || !authSession.access_token) return Promise.resolve(null);
    if (authSession.expires_at > Math.floor(Date.now() / 1000) + 60) return Promise.resolve(authSession.access_token);
    return refreshAuthSession();
  }
  function renderAccount() {
    var button = $("accountBtn");
    if (!button) return;
    button.textContent = authSession && authSession.user && authSession.user.email
      ? authSession.user.email
      : "تسجيل الدخول";
    button.title = authSession ? "تسجيل الخروج" : "تسجيل الدخول لربط تقدمك";
  }
  function setAuthMode(mode) {
    authMode = mode;
    var signingUp = mode === "signup";
    $("authTitle").textContent = signingUp ? "إنشاء حساب" : "تسجيل الدخول";
    $("authDescription").textContent = signingUp
      ? "أنشئ حسابًا لربط تقدمك الدراسي."
      : "سجّل الدخول لربط تقدمك الدراسي بحسابك.";
    $("authSubmit").textContent = signingUp ? "إنشاء الحساب" : "دخول";
    $("authToggle").textContent = signingUp ? "لديك حساب؟ سجّل الدخول" : "إنشاء حساب جديد";
    $("authPassword").autocomplete = signingUp ? "new-password" : "current-password";
  }
  function signOut() {
    flushCloudSave().then(function () { return getAccessToken(); }).then(function (token) {
      if (!token) return;
      return authRequest("/auth/v1/logout?scope=local", {}, token);
    }).then(function () {
      clearAuthSession();
    }).catch(function (error) {
      console.error("Supabase sign-out failed:", error);
      clearAuthSession();
      hint("تم تسجيل الخروج من هذا المتصفح، لكن تعذّر إنهاء الجلسة لدى Supabase.", true);
    });
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
    var links = [];
    var text = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (match, label, url) {
      var service = serviceForUrl(url);
      if (!service) return match;
      links.push('<a href="' + esc(service.href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>");
      return "\uE000" + (links.length - 1) + "\uE001";
    });
    text = text.replace(/https?:\/\/[^\s<>"']+/g, function (url) {
      var trimmed = url.replace(/[.,،؛!?؟]+$/g, "");
      var service = serviceForUrl(trimmed);
      if (!service) return url;
      links.push('<a href="' + esc(service.href) + '" target="_blank" rel="noopener noreferrer">' + esc(service.name) + "</a>");
      return "\uE000" + (links.length - 1) + "\uE001" + url.slice(trimmed.length);
    });
    return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\uE000(\d+)\uE001/g, function (match, index) { return links[Number(index)] || ""; });
  }
  function serviceForUrl(value) {
    try {
      var url = new URL(value.replace(/&amp;/g, "&"));
      return url.protocol === "https:" ? SERVICE_LINKS[url.hostname.toLowerCase()] : null;
    } catch (e) {
      return null;
    }
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
        var userId = authSession && authSession.user && authSession.user.id;
        state.chats = state.chats.filter(function (x) { return x.id !== c.id; });
        save(false);
        deleteCloudChat(userId, c.id);
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
      inner.classList.add("welcome-inner");
      var w = document.createElement("div");
      w.className = "welcome";
      w.innerHTML = '<section class="welcome-hero">' +
        '<div class="welcome-copy">' +
        '<span class="welcome-kicker"><i></i> مساعدك الدراسي من ilogia</span>' +
        '<h1>كل سؤال هو <span>بداية لفهم جديد</span></h1>' +
        '<p>اشرح الدرس، بسّط فكرة صعبة، أو اختبر نفسك — وخلي مذاكرتك أوضح خطوة بخطوة.</p>' +
        '<div class="welcome-points">' +
        '<span><svg class="ic"><use href="#i-bulb"/></svg>شرح يناسبك</span>' +
        '<span><svg class="ic"><use href="#i-file"/></svg>مراجعة مركّزة</span>' +
        '<span><svg class="ic"><use href="#i-help"/></svg>تدريب تفاعلي</span>' +
        '</div></div>' +
        '<div class="welcome-visual" aria-hidden="true">' +
        '<div class="visual-orbit orbit-one"></div><div class="visual-orbit orbit-two"></div>' +
        '<div class="visual-note note-top"><svg class="ic"><use href="#i-bulb"/></svg><span>فهم أعمق</span></div>' +
        '<div class="visual-card"><div class="visual-cap"><svg class="ic"><use href="#i-cap"/></svg></div>' +
        '<small>مساحتك للتعلّم</small><strong>خطوة.. خطوة</strong>' +
        '<div class="visual-progress"><i></i></div><span class="visual-caption">افهم · طبّق · تقدّم</span></div>' +
        '<div class="visual-note note-bottom"><svg class="ic"><use href="#i-help"/></svg><span>تعلّم بطريقتك</span></div>' +
        '</div></section>' +
        '<div class="welcome-section"><div class="welcome-section-heading"><div><span>ابدأ من هنا</span>' +
        '<h2>إيه اللي تحب تعمله النهارده؟</h2></div><small>اختار طريقة تساعدك في مذاكرتك</small></div></div>';
      var g = document.createElement("div");
      g.className = "starts";
      STARTS.forEach(function (s) {
        var b = document.createElement("button");
        b.className = "start";
        b.innerHTML = '<span class="start-icon"><svg class="ic"><use href="#' + s.icon + '"/></svg></span>' +
          '<span class="start-copy"><b>' + s.t + '</b><span class="start-desc">' + s.s + '</span></span>' +
          '<span class="start-arrow" aria-hidden="true">↗</span>';
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
    if (SB_URL && CFG.SUPABASE_KEY) { s.textContent = "جاهز"; s.className = "status live"; }
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

    var p = authReady.then(getAccessToken).then(function (token) {
      if (!token) {
        return new Promise(function (res) {
          setTimeout(function () {
            res({ content: demoReply(state.mode, full, c.subject), note: "سجّل الدخول للاتصال بـ Gemini." });
          }, 500);
        });
      }
      return fetch(SB_URL + "/functions/v1/ilogia-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: CFG.SUPABASE_KEY,
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          mode: state.mode,
          subject: c.subject,
          messages: sendMsgs.slice(-12)
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401) clearAuthSession();
          if (!r.ok || j.error) throw new Error(j.error || "خطأ في الخادم");
          return { content: j.reply };
        });
      });
    });
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
    load();
    setStatus();
    if (SB_URL && CFG.SUPABASE_KEY) {
      authReady = restoreAuthSession().then(function () {
        if (authSession && authSession.user && authSession.user.id) loadCurrentAccountChats();
      });
      load();
    }
    else authReady = Promise.resolve();
    if (!chatsLoaded) load();
    $("accountBtn").onclick = function () {
      if (authSession) {
        if (state.busy) { hint("انتظر حتى تنتهي الإجابة قبل تسجيل الخروج.", true); return; }
        if (confirm("هل تريد تسجيل الخروج؟")) signOut();
        return;
      }
      if (!SB_URL || !CFG.SUPABASE_KEY) {
        hint("تسجيل الدخول غير مهيأ. أضف إعدادات Supabase العامة إلى config.js.", true);
        return;
      }
      $("authError").textContent = "";
      setAuthMode("signin");
      $("authDialog").showModal();
    };
    $("authClose").onclick = function () { $("authDialog").close(); };
    $("authToggle").onclick = function () {
      $("authError").textContent = "";
      setAuthMode(authMode === "signin" ? "signup" : "signin");
    };
    $("authForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var email = $("authEmail").value.trim();
      var password = $("authPassword").value;
      var endpoint = authMode === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
      $("authSubmit").disabled = true;
      $("authError").textContent = "";
      authRequest(endpoint, { email: email, password: password }).then(function (data) {
        if (!saveAuthSession(data)) {
          $("authError").textContent = "تم إنشاء الحساب. راجع بريدك الإلكتروني لتأكيده، ثم سجّل الدخول.";
          setAuthMode("signin");
          return;
        }
        $("authPassword").value = "";
        $("authDialog").close();
        hint("");
      }).catch(function (error) {
        $("authError").textContent = error.message;
      }).then(function () {
        $("authSubmit").disabled = false;
      });
    });
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
  }
  init();
})();
