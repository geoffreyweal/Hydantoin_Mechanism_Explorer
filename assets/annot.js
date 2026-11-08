/* Hydantoin Mechanism Explorer: the collaborators' statuses and edits, and signing in (window.Annot).

   Everything is kept in one file, annotations.json, on its own branch of the site's GitHub repository (config.js):
     status[ch|id]  = {s: "yes"|"no", note, by, at}     a mechanism or step marked possible / not possible, per
                                                        chalcogen ("S|S7b"); one status per item, the last change wins
     species[UIn], steps[USn], mechanisms[Un]           added by a collaborator ({..., ch: ["O","S"], by, at, uid})
   "Remove from network" is not kept there: a removal lasts only for this page (TEMP, gone after a reload) and is never
   saved or shared. Removals that an earlier version wrote into the file are ignored, and dropped at the next save.
   Anyone can read it (raw.githubusercontent.com). Collaborators sign in with GitHub: "Sign in with GitHub" sends them
   to GitHub (the site's GitHub App, web flow, with a random state and a PKCE challenge); GitHub sends them back with
   a one-time code, which a small Cloudflare Worker (config.js tokenUrl, see signin_worker/) swaps for a user token,
   because that needs the app's client secret. The token is kept in this browser (sessionStorage, or localStorage when
   "remember on this computer" is ticked), is sent only to api.github.com, and expires after about 8 hours. Only users
   with push access to the repository can change anything.

   Each click becomes an operation in a queue. About 2 s after the last click the queue is applied to the file and
   saved as one commit (Contents API). If someone else saved in between (409/422), the file is read again and the
   operations are applied to it again: for a status the newer change wins for that item. Everything read
   from the file is checked and cleaned first, and is only ever shown as text. */
(function () {
  "use strict";
  var API = "https://api.github.com", RAW = "https://raw.githubusercontent.com", AUTHORIZE = "https://github.com/login/oauth/authorize";
  var SESSION_KEY = "hme.github.session", SIGNIN_KEY = "hme.github.signin", OLD_TOKEN_KEY = "hme.github.token";
  var LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, KEY = /^[OS]\|[A-Za-z][A-Za-z0-9_.-]{0,39}$/, UID = /^[a-z0-9]{6,32}$/;
  var SPID = "[A-Za-z][A-Za-z0-9_.-]{0,39}", STATE = new RegExp("^(?:\\d{1,2} )?" + SPID + "(?: \\+ (?:\\d{1,2} )?" + SPID + "){0,7}$");
  var KINDS = { species: { prefix: "UI", re: /^UI\d{1,5}$/, word: "species" }, steps: { prefix: "US", re: /^US\d{1,5}$/, word: "step" },
                mechanisms: { prefix: "U", re: /^U\d{1,5}$/, word: "mechanism" } };
  var STEP_REF = new RegExp("^" + SPID + "$"), TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?Z$/;
  var TOKEN = /^[A-Za-z0-9_]{20,255}$/, CODE = /^[A-Za-z0-9_-]{8,128}$/, CLIENT_ID = /^[A-Za-z0-9._-]{8,64}$/;
  var DEBOUNCE = 2000, RETRIES = 4, TOKEN_LIFE = 8 * 3600, SIGNIN_WAIT = 15 * 60 * 1000;
  var EXPIRED = "sign-in expired, sign in again";
  function has(o, k) { return !!o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); }
  /* In a frame (another site showing this page): no sign-in and no stored token, so that a framing page cannot
     trick a collaborator into clicking buttons. */
  var FRAMED = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();

  // ------------------------------------------------------------------ where the file is, and the sign-in settings
  var CFG = (function () {
    var src = window.HME_CONFIG || {}, c = {};
    ["owner", "repo", "branch", "file", "clientId", "tokenUrl"].forEach(function (k) { c[k] = typeof src[k] === "string" ? src[k].trim() : ""; });
    var host = /^([A-Za-z0-9-]+)\.github\.io$/i.exec(location.hostname || ""), seg = (location.pathname || "/").split("/")[1] || "";
    if (host && seg && !/\.html?$/i.test(seg)) {
      c.owner = host[1];
      try { c.repo = decodeURIComponent(seg); } catch (e) { c.repo = seg; }
    }
    c.branch = c.branch || "annotations";
    c.file = c.file || "annotations.json";
    c.ok = LOGIN.test(c.owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(c.repo) && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(c.branch) &&
      /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(c.file);
    c.tokenOrigin = "";
    try {
      var u = new URL(c.tokenUrl);
      if (u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash) c.tokenOrigin = u.origin;
    } catch (e) { /* not a URL: no sign-in */ }
    c.signInSet = !!(c.clientId || c.tokenUrl);
    c.signInOK = CLIENT_ID.test(c.clientId) && !!c.tokenOrigin;
    return c;
  })();
  function repoPath() { return "/repos/" + CFG.owner + "/" + CFG.repo; }
  function contentsPath() { return repoPath() + "/contents/" + CFG.file.split("/").map(encodeURIComponent).join("/"); }
  function siteUrl() { return location.origin + location.pathname.replace(/index\.html?$/i, ""); }   // = the app's callback URL
  function cspAllows(origin) {     // the page's Content-Security-Policy must let it talk to the sign-in Worker
    var meta = document.querySelector("meta[http-equiv='Content-Security-Policy']");
    if (!meta) return true;
    var m = /(?:^|;)\s*connect-src([^;]*)/i.exec(meta.getAttribute("content") || "");
    if (!m) return /(?:^|;)\s*default-src[^;]*\*/.test(meta.getAttribute("content") || "");
    return m[1].trim().split(/\s+/).some(function (t) {
      if (t === origin) return true;
      var w = /^https:\/\/\*\.([A-Za-z0-9.-]+)$/.exec(t);
      return !!w && origin.slice(-(w[1].length + 1)) === "." + w[1] && origin.indexOf("https://") === 0;
    });
  }
  function signInBlock() {         // why sign-in is not offered ("" when it is)
    if (!CFG.ok) return "no repository is set in assets/config.js";
    if (!CFG.signInSet) return "sign-in not set up yet";
    if (!CFG.signInOK) return "sign-in is not set up correctly (clientId or tokenUrl in assets/config.js)";
    if (location.protocol === "file:") return "sign-in only works on the website, not from a file";
    if (FRAMED) return "open the site in its own tab to sign in";
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder && window.history && history.replaceState)) return "sign-in needs a secure (https) page";
    if (!cspAllows(CFG.tokenOrigin)) return "sign-in not set up yet (rebuild the site after setting tokenUrl)";
    return "";
  }

  // ------------------------------------------------------------------ coming back from GitHub (?code=…&state=…)
  /* Read and remove the code from the address at once (before anything else runs): it is single-use and must not stay
     in the history. The address gets back the hash it had when "Sign in with GitHub" was pressed. */
  var RETURN = (function () {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return null; }
    var code = q.get("code"), state = q.get("state"), err = q.get("error");
    if (!state || (!code && !err)) return null;
    var keep = null;
    try { keep = JSON.parse(sessionStorage.getItem(SIGNIN_KEY) || "null"); sessionStorage.removeItem(SIGNIN_KEY); } catch (e) { keep = null; }
    if (!keep || typeof keep !== "object" || Array.isArray(keep)) keep = null;
    ["code", "state", "error", "error_description", "error_uri"].forEach(function (k) { q.delete(k); });
    var hash = keep && typeof keep.hash === "string" && /^(#[^\s<>"]{0,2000})?$/.test(keep.hash) ? keep.hash : location.hash;
    try { history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q.toString() : "") + hash); } catch (e) { /* old browser */ }
    var r = { ok: false, code: code, keep: keep, problem: "" };
    if (!keep || typeof keep.state !== "string" || keep.state !== state) r.problem = "sign-in refused: GitHub's reply does not belong to a sign-in started here (state does not match); please sign in again";
    else if (!(Date.now() - keep.at < SIGNIN_WAIT)) r.problem = "sign-in took too long: please sign in again";
    else if (err) r.problem = err === "access_denied" ? "sign-in cancelled" : "GitHub did not sign you in (" + String(err).replace(/[^a-z_]/gi, "").slice(0, 40) + ")";
    else if (!CODE.test(code || "")) r.problem = "sign-in refused: GitHub's reply has no valid code";
    else if (typeof keep.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(keep.verifier)) r.problem = "sign-in refused: the sign-in state is incomplete; please sign in again";
    else r.ok = true;
    return r;
  })();

  // ------------------------------------------------------------------ state
  var A = {
    token: "", exp: 0, user: null, canEdit: false, repo: null, branchOK: false,
    remote: empty(), sha: null, local: empty(), loaded: false, loadedAt: 0, source: "", error: "", broken: false,
    pending: [], saving: false, timer: null, save: { state: "idle", msg: "" }, notice: "", listeners: [], authError: "", leaving: false
  };
  function empty() { return { format: "hydantoin-mechanism-annotations", version: 2, status: {}, species: {}, steps: {}, mechanisms: {} }; }
  function now() { return new Date().toISOString(); }
  function later(at) {             // now, but never before an earlier change of the same item (clocks differ a little)
    var t = Date.parse(at || "");
    return new Date(Math.max(Date.now(), isNaN(t) ? 0 : t + 1)).toISOString();
  }
  function newer(a, b) { var x = Date.parse(a || ""), y = Date.parse(b || ""); return !isNaN(x) && (isNaN(y) || x > y); }
  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function random(n) { var a = new Uint8Array(n); window.crypto.getRandomValues(a); return a; }
  function uid() {
    var a = random(9), s = "";
    for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return s + Date.now().toString(36);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function emit() {
    A.listeners.forEach(function (f) { try { f(); } catch (e) { if (window.console) console.error(e); } });
  }

  // ------------------------------------------------------------------ the token (never leaves this browser except to api.github.com)
  function storages() { var out = []; try { out.push(sessionStorage); } catch (e) { /* blocked */ } try { out.push(localStorage); } catch (e) { /* blocked */ } return out; }
  function readSession() {
    if (FRAMED) return null;
    var got = null;
    storages().forEach(function (st) {
      try {
        st.removeItem(OLD_TOKEN_KEY);                 // pasted tokens of an earlier version: never used again
        var s = JSON.parse(st.getItem(SESSION_KEY) || "null");
        if (!got && s && typeof s.t === "string" && TOKEN.test(s.t) && typeof s.exp === "number") got = s;
      } catch (e) { /* unreadable: ignored */ }
    });
    return got;
  }
  function writeSession(t, exp, remember) {
    forgetSession();
    try { (remember && location.protocol !== "file:" ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify({ t: t, exp: exp })); }
    catch (e) { /* storage blocked: signed in for this page only */ }
  }
  function forgetSession() { storages().forEach(function (st) { try { st.removeItem(SESSION_KEY); st.removeItem(OLD_TOKEN_KEY); } catch (e) { /* none */ } }); }
  function expire() {              // GitHub no longer takes the token (it expired or was revoked)
    if (A.user) A.pendingLogin = A.user.login;      // whose unsaved changes these are (kept over a new sign-in)
    forgetSession();
    A.token = ""; A.exp = 0; A.user = null; A.canEdit = false; A.repo = null;
    A.authError = EXPIRED;
    emit();
  }

  // ------------------------------------------------------------------ GitHub REST API
  function api(method, path, body) {
    if (!/^\/[A-Za-z0-9_.\/%?=&,-]*$/.test(path)) return Promise.reject(new Error("bad API path"));
    var h = { Accept: "application/vnd.github+json" }, sent = A.token;
    if (sent) h.Authorization = "Bearer " + sent;
    if (body !== undefined) h["Content-Type"] = "application/json";
    return fetch(API + path, { method: method, headers: h, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
                               body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          if (!r.ok) {
            if (r.status === 401 && sent && sent === A.token) expire();
            var msg = j && typeof j.message === "string" ? j.message.slice(0, 200) : "HTTP " + r.status;
            var err = new Error(r.status === 401 && sent ? EXPIRED : msg);
            err.status = r.status;
            throw err;
          }
          return j;
        });
      });
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ------------------------------------------------------------------ checking what is read (the file can be edited by hand)
  function text(x, n) {
    return typeof x === "string" ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, "").trim().slice(0, n) : "";
  }
  function time(x) { return typeof x === "string" && TIME.test(x) ? x : ""; }
  function chs(x) {
    var out = [];
    (Array.isArray(x) ? x : []).forEach(function (c) { if ((c === "O" || c === "S") && out.indexOf(c) < 0) out.push(c); });
    return out.sort();
  }
  function state(x) { return typeof x === "string" && STATE.test(x) ? x : ""; }
  function own(o) { return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }
  function smiles(x) { var s = text(x, 300); return /^[A-Za-z0-9@+\-\[\]()\\\/%=#$:.*~]*$/.test(s) ? s : ""; }
  /* an added species, step or mechanism, cleaned; null when it is not usable */
  function cleanItem(kind, e) {
    e = own(e);
    if (!text(e.name, 120) || !chs(e.ch).length) return null;
    var it = { uid: UID.test(e.uid || "") ? e.uid : "", name: text(e.name, 120), ch: chs(e.ch), by: LOGIN.test(e.by || "") ? e.by : "", at: time(e.at) };
    if (kind === "species") { it.smiles = smiles(e.smiles); it.note = text(e.note, 300); }
    if (kind === "steps") {
      it.from = state(e.from); it.to = state(e.to); it.desc = text(e.desc, 1000);
      if (!it.from || !it.to) return null;
    }
    if (kind === "mechanisms") {
      it.desc = text(e.desc, 1000); it.product = state(e.product);
      it.hops = (Array.isArray(e.hops) ? e.hops : []).slice(0, 200).map(function (h) {
        h = own(h);
        var step = h.step === null || h.step === undefined ? null : (typeof h.step === "string" && STEP_REF.test(h.step) ? h.step : false);
        var hop = { step: step, dir: h.dir === "rev" ? "rev" : "fwd", from: state(h.from), to: state(h.to) };
        return step === false || !hop.from || !hop.to ? null : hop;
      });
      if (!it.hops.length || it.hops.some(function (h) { return !h; })) return null;
      it.path = (Array.isArray(e.path) ? e.path : []).slice(0, 401).filter(function (t) { return state(t) || (typeof t === "string" && STEP_REF.test(t)); });
    }
    return it;
  }
  function clean(raw) {
    var d = empty();
    raw = own(raw);
    var ST = own(raw.status);
    Object.keys(ST).forEach(function (k) {
      var e = own(ST[k]);
      if (KEY.test(k) && (e.s === "yes" || e.s === "no") && LOGIN.test(e.by || "")) d.status[k] = { s: e.s, note: text(e.note, 300), by: e.by, at: time(e.at) };
    });
    // raw.removed (removals saved by an earlier version) is ignored: removals only last for one page now
    Object.keys(KINDS).forEach(function (kind) {
      var src = own(raw[kind]);
      Object.keys(src).forEach(function (id) {
        var it = KINDS[kind].re.test(id) ? cleanItem(kind, src[id]) : null;
        if (!it || !it.by) return;
        if (!it.uid) it.uid = "x" + id.toLowerCase() + "000000";
        d[kind][id] = it;
      });
    });
    return d;
  }
  function parseDoc(t) {
    var j;
    if (!String(t).trim()) return empty();               // an empty file: nothing yet
    try { j = JSON.parse(t); } catch (e) {
      var err = new Error(CFG.file + " on the " + CFG.branch + " branch is not valid JSON, so nothing can be saved until it is fixed");
      err.broken = true;
      throw err;
    }
    return clean(j);
  }
  function sortKeys(x) {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (!x || typeof x !== "object") return x;
    var o = {};
    Object.keys(x).sort(function (a, b) { return a.localeCompare(b, "en", { numeric: true }); }).forEach(function (k) { o[k] = sortKeys(x[k]); });
    return o;
  }

  // ------------------------------------------------------------------ operations (the queue) and how they change the file
  function nextId(d, kind) {
    var k = KINDS[kind], n = 0;
    [d[kind]].concat([A.local[kind]]).forEach(function (coll) {
      Object.keys(coll).forEach(function (id) { if (k.re.test(id)) n = Math.max(n, +id.slice(k.prefix.length)); });
    });
    return k.prefix + (n + 1);
  }
  function mapper(remap) {
    var id = function (x) { return remap[x] || x; };
    return {
      id: id,
      key: function (k) { var q = k.split("|"); return q[0] + "|" + id(q[1]); },
      state: function (s) { return s.split(" + ").map(function (t) { var m = /^(\d+ )?(.+)$/.exec(t); return (m[1] || "") + id(m[2]); }).join(" + "); }
    };
  }
  function applyOps(doc, ops, login) {
    var d = clone(doc), remap = {};
    ops.forEach(function (op) {
      var m = mapper(remap), k;
      if (op.t === "status") {                             // the newer change of an item wins
        k = m.key(op.key);
        if (has(d.status, k) && newer(d.status[k].at, op.at)) return;
        if (op.s) d.status[k] = { s: op.s, note: op.note || "", by: login, at: op.at };
        else delete d.status[k];
      } else if (op.t === "add") {
        var coll = d[op.kind], id = op.id, item = clone(op.item);
        if (has(coll, id) && coll[id].uid !== item.uid) { remap[op.id] = id = nextId(d, op.kind); m = mapper(remap); }
        if (op.kind === "steps") { item.from = m.state(item.from); item.to = m.state(item.to); }
        if (op.kind === "mechanisms") {
          item.hops = item.hops.map(function (h) { return { step: h.step ? m.id(h.step) : null, dir: h.dir, from: m.state(h.from), to: m.state(h.to) }; });
          item.path = item.path.map(function (t) { return STATE.test(t) ? m.state(t) : m.id(t); });
          item.product = m.state(item.product);
        }
        item.by = login;
        coll[id] = item;
      } else if (op.t === "delete") {
        var c = d[op.kind];
        Object.keys(c).forEach(function (cid) {
          if (c[cid].uid !== op.uid || c[cid].by !== login) return;
          delete c[cid];
          ["O", "S"].forEach(function (ch) { delete d.status[ch + "|" + cid]; });
        });
      }
    });
    return { doc: d, remap: remap };
  }
  function rewriteOps(ops, remap) {
    if (!Object.keys(remap).length) return ops;
    var m = mapper(remap);
    return ops.map(function (op) {
      var o = clone(op);
      if (o.key) o.key = m.key(o.key);
      if (o.t === "add") {
        if (o.kind === "steps") { o.item.from = m.state(o.item.from); o.item.to = m.state(o.item.to); }
        if (o.kind === "mechanisms") {
          o.item.hops = o.item.hops.map(function (h) { return { step: h.step ? m.id(h.step) : null, dir: h.dir, from: m.state(h.from), to: m.state(h.to) }; });
          o.item.path = o.item.path.map(function (t) { return STATE.test(t) ? m.state(t) : m.id(t); });
          o.item.product = m.state(o.item.product);
        }
      }
      return o;
    });
  }
  /* the queue kept over a sign-in (sessionStorage): checked like everything else that is read */
  function cleanOps(list) {
    return (Array.isArray(list) ? list : []).slice(0, 500).map(function (op) {
      op = own(op);
      var at = time(op.at) || now();
      if (op.t === "status" && KEY.test(op.key || "") && (op.s === "yes" || op.s === "no" || op.s === null)) return { t: "status", key: op.key, s: op.s, note: text(op.note, 300), at: at };
      if (op.t === "add" && has(KINDS, op.kind) && KINDS[op.kind].re.test(op.id || "")) {
        var it = cleanItem(op.kind, op.item);
        return it && UID.test(it.uid) ? { t: "add", kind: op.kind, id: op.id, item: it, at: at } : null;
      }
      if (op.t === "delete" && has(KINDS, op.kind) && UID.test(op.uid || "")) return { t: "delete", kind: op.kind, id: text(op.id, 20), uid: op.uid, at: at };
      return null;
    }).filter(Boolean);
  }
  function recompute() {             // what the page shows: the file, with this tab's unsaved changes on top
    var who = A.user ? A.user.login : A.pending.length ? A.pendingLogin : "";
    A.local = who ? applyOps(A.remote, A.pending, who).doc : clone(A.remote);
  }
  function describe(ops, remap, login) {
    var parts = [], idx = {}, m = mapper(remap);
    ops.forEach(function (op) {
      var id, ch = "", what = "";
      if (op.key) { var q = m.key(op.key).split("|"); ch = q[0]; id = q[1]; } else id = op.id ? m.id(op.id) : "";
      if (op.t === "status") what = op.s === "yes" ? "possible" : op.s === "no" ? "not possible" : "status cleared";
      var k = op.t + "|" + (op.kind || "") + "|" + id + "|" + what;
      if (!idx[k]) { idx[k] = { t: op.t, kind: op.kind, id: id, what: what, chs: [] }; parts.push(idx[k]); }
      if (ch && idx[k].chs.indexOf(ch) < 0) idx[k].chs.push(ch);
    });
    var txt = parts.map(function (p) {
      var c = p.chs.length ? " (" + p.chs.sort().join(", ") + ")" : "";
      if (p.t === "status") return p.id + c + " " + p.what;
      if (p.t === "add") return "added " + KINDS[p.kind].word + " " + p.id;
      return "deleted " + KINDS[p.kind].word + " " + p.id;
    });
    var out = (parts.every(function (p) { return p.t === "status"; }) ? "Statuses" : "Annotations") + " by @" + login + ": ";
    for (var i = 0; i < txt.length; i++) {
      if (i && (out + txt[i]).length > 160) { out += ", … (+" + (txt.length - i) + " more)"; break; }
      out += (i ? ", " : "") + txt[i];
    }
    return out;
  }

  // ------------------------------------------------------------------ reading and writing annotations.json
  function fetchRemote() {
    if (A.token) {
      return api("GET", contentsPath() + "?ref=" + encodeURIComponent(CFG.branch)).then(function (j) {
        A.branchOK = true;
        if (!j || Array.isArray(j) || typeof j.sha !== "string" || !/^[0-9a-f]{40,64}$/.test(j.sha)) throw new Error(CFG.file + " is not a file");
        var got = j.encoding === "base64" && j.content ? Promise.resolve(b64decode(j.content)) :
          api("GET", repoPath() + "/git/blobs/" + j.sha).then(function (b) { return b64decode(b.content); });
        return got.then(function (t) { return { doc: parseDoc(t), sha: j.sha }; });
      }, function (e) {
        if (e.status === 404) return { doc: empty(), sha: null };          // no branch or no file yet: nothing yet
        throw e;
      });
    }
    var url = RAW + "/" + CFG.owner + "/" + CFG.repo + "/" + CFG.branch + "/" + CFG.file;
    return fetch(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (t) { return { doc: t === null ? empty() : parseDoc(t), sha: null }; });
  }
  function load() {
    if (!CFG.ok) { A.error = "no repository is set in assets/config.js"; emit(); return Promise.resolve(); }
    A.loading = true;
    emit();
    return fetchRemote().then(function (r) {
      A.remote = r.doc; A.sha = r.sha; A.loaded = true; A.loadedAt = Date.now(); A.broken = false; A.error = "";
      A.source = A.token ? "api" : "raw"; A.loading = false;
      recompute();
      emit();
    }, function (e) {
      A.loading = false; A.error = e.message || String(e);
      if (e.broken) A.broken = true;
      if (e.status === 401) return load();                 // the sign-in ran out while reading: read as a visitor
      emit();
    });
  }
  function ensureBranch() {
    if (A.branchOK) return Promise.resolve();
    var br = encodeURIComponent(CFG.branch).replace(/%2F/g, "/");
    return api("GET", repoPath() + "/branches/" + br).then(function () { A.branchOK = true; }, function (e) {
      if (e.status !== 404) throw e;
      var base = (A.repo && typeof A.repo.default_branch === "string" && A.repo.default_branch) || "main";
      return api("GET", repoPath() + "/git/ref/heads/" + encodeURIComponent(base).replace(/%2F/g, "/")).then(function (ref) {
        return api("POST", repoPath() + "/git/refs", { ref: "refs/heads/" + CFG.branch, sha: ref.object.sha });
      }).then(null, function (e2) { if (e2.status !== 422) throw e2; })   // 422: someone made it in the meantime
        .then(function () { A.branchOK = true; });
    });
  }
  function setSave(st, msg) { A.save = { state: st, msg: msg || "" }; emit(); }
  function schedule() {
    clearTimeout(A.timer);
    if (A.pending.length) setSave("pending", A.pending.length + " unsaved change" + (A.pending.length > 1 ? "s" : ""));
    A.timer = setTimeout(save, DEBOUNCE);
  }
  function save() {
    clearTimeout(A.timer);
    if (A.saving || !A.pending.length || !A.user) return Promise.resolve();
    if (!A.canEdit) { setSave("error", "@" + A.user.login + " has no push access to " + CFG.owner + "/" + CFG.repo); return Promise.resolve(); }
    if (A.broken) { setSave("error", A.error); return Promise.resolve(); }
    var batch = A.pending.slice(), tries = 0, login = A.user.login;
    A.saving = true;
    setSave("saving", "saving…");
    function attempt() {
      var res = applyOps(A.remote, batch, login), body = {
        message: describe(batch, res.remap, login),
        content: b64encode(JSON.stringify(sortKeys(res.doc), null, 1) + "\n"),
        branch: CFG.branch
      };
      if (A.sha) body.sha = A.sha;
      return ensureBranch().then(function () { return api("PUT", contentsPath(), body); }).then(function (r) {
        A.remote = res.doc;
        A.sha = r && r.content && typeof r.content.sha === "string" ? r.content.sha : A.sha;
        A.pending = rewriteOps(A.pending.slice(batch.length), res.remap);
        A.saving = false; A.loadedAt = Date.now();
        var moved = Object.keys(res.remap).map(function (k) { return k + " is now " + res.remap[k]; });
        A.notice = moved.length ? moved.join(", ") + " (someone else had already used " + (moved.length > 1 ? "those IDs" : "that ID") + ")" : "";
        A.lastRemap = res.remap;
        recompute();
        setSave("saved", "saved");
        if (A.pending.length) schedule();
      }, function (e) {
        if ((e.status === 409 || e.status === 422) && tries < RETRIES) {      // someone saved in between: read, apply again, retry
          tries++;
          return fetchRemote().then(function (r) { A.remote = r.doc; A.sha = r.sha; return attempt(); });
        }
        throw e;
      });
    }
    return attempt().then(null, function (e) {
      A.saving = false;
      if (e.broken) A.broken = true;
      var msg = e.status === 401 ? EXPIRED + " (your changes are kept and saved after you sign in)" :
        e.status === 409 || e.status === 422 ? CFG.file + " kept changing on GitHub while saving; press retry (GitHub: " + e.message + ")" :
        e.status === 403 || e.status === 404 ? "GitHub refused the save (" + e.message + "); is the site's GitHub App installed on " + CFG.repo + " with Contents: Read and write?" :
        e.message || String(e);
      recompute();
      setSave("error", msg);
    });
  }
  var UNDO = [], REDO = [];          // this visit's changes, kept as the operations that take them back
  var TEMP = Object.create(null);    // "remove from network": {"O|S7b": {by, at, note}}, this page only, never saved
  function invert(ops) {             // the operations that undo `ops`, from what the page shows now
    var inv = [];
    ops.forEach(function (op) {
      if (op.t === "status") {
        var cur = has(A.local.status, op.key) ? A.local.status[op.key] : null;
        inv.push({ t: "status", key: op.key, s: cur ? cur.s : null, note: cur ? cur.note || "" : "" });
      } else if (op.t === "remove" || op.t === "restore") {
        var was = TEMP[op.key] || null;
        inv.push(was ? { t: "remove", key: op.key, note: was.note || "" } : { t: "restore", key: op.key });
      } else if (op.t === "add") {
        inv.push({ t: "delete", kind: op.kind, id: op.id, uid: op.item.uid });
      } else if (op.t === "delete") {
        var it = has(A.local[op.kind], op.id) ? A.local[op.kind][op.id] : null;
        if (!it) return;
        inv.push({ t: "add", kind: op.kind, id: op.id, item: clone(it) });
        ["O", "S"].forEach(function (ch) {
          var k = ch + "|" + op.id;
          if (has(A.local.status, k)) inv.push({ t: "status", key: k, s: A.local.status[k].s, note: A.local.status[k].note || "" });
          if (TEMP[k]) inv.push({ t: "remove", key: k, note: TEMP[k].note || "" });
        });
      }
    });
    return inv.reverse();
  }
  function push(ops, how) {          // how: undefined (a change), "undo" or "redo"
    if (!A.user || !A.canEdit || !A.loaded) return false;      // never edit a file that could not be read
    var inv = invert(ops);
    if (inv.length) {
      (how === "undo" ? REDO : UNDO).push(inv);
      if (!how) REDO.length = 0;
      if (UNDO.length > 200) UNDO.shift();
    }
    var shared = 0;
    ops.forEach(function (op) {
      if (op.t === "remove") { TEMP[op.key] = { by: A.user.login, at: now(), note: op.note || "" }; return; }   // this page only
      if (op.t === "restore") { delete TEMP[op.key]; return; }
      if (op.t === "delete") ["O", "S"].forEach(function (ch) { delete TEMP[ch + "|" + op.id]; });
      var cur = op.t === "status" && has(A.local.status, op.key) ? A.local.status[op.key] : null;
      op.at = later(cur ? cur.at : "");
      A.pending.push(op);
      shared++;
    });
    if (shared) { recompute(); schedule(); }
    emit();
    return true;
  }

  // ------------------------------------------------------------------ signing in and out
  function verify(t) {
    A.token = t;
    return api("GET", "/user").then(function (u) {
      if (!u || !LOGIN.test(u.login || "")) throw new Error("GitHub did not say who is signed in");
      A.user = { login: u.login, name: text(u.name, 100) };
      return api("GET", repoPath()).then(function (r) {
        A.repo = r || {};
        A.canEdit = !!(r && r.permissions && r.permissions.push);
      }, function (e) {
        if (e.status !== 404) throw e;
        A.repo = {}; A.canEdit = false;
      });
    }).then(null, function (e) {
      if (A.token === t) { A.token = ""; A.user = null; A.canEdit = false; }
      throw e;
    });
  }
  /* "Sign in with GitHub": a random state and a PKCE verifier are kept in this tab, then the browser goes to GitHub */
  function startSignIn(remember) {
    var why = signInBlock();
    if (why) return Promise.reject(new Error(why));
    var keep = { state: b64url(random(24)), verifier: b64url(random(32)), hash: location.hash || "", remember: !!remember, at: Date.now() };
    var owner = A.user ? A.user.login : A.pendingLogin;
    if (owner && A.pending.length) keep.pending = { login: owner, ops: A.pending };          // saved after the sign-in
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(keep.verifier)).then(function (h) {
      try { sessionStorage.setItem(SIGNIN_KEY, JSON.stringify(keep)); } catch (e) { throw new Error("this browser does not let the page keep the sign-in state (storage blocked)"); }
      A.leaving = true;
      location.assign(AUTHORIZE + "?client_id=" + encodeURIComponent(CFG.clientId) + "&redirect_uri=" + encodeURIComponent(siteUrl()) +
                      "&state=" + encodeURIComponent(keep.state) + "&code_challenge=" + b64url(new Uint8Array(h)) + "&code_challenge_method=S256");
    });
  }
  /* back from GitHub with a code: the Worker swaps it (with the verifier) for a user token */
  function exchange(code, verifier) {
    return fetch(CFG.tokenUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
                                 body: JSON.stringify({ code: code, code_verifier: verifier }), cache: "no-store", credentials: "omit",
                                 referrerPolicy: "no-referrer", mode: "cors" })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) { j = null; }
          if (!r.ok || !j || typeof j.access_token !== "string") {
            throw new Error(j && typeof j.error === "string" ? j.error.replace(/[^A-Za-z_]/g, "").slice(0, 60) : "the sign-in service answered HTTP " + r.status);
          }
          if (!TOKEN.test(j.access_token) || (j.token_type !== undefined && !/^bearer$/i.test(String(j.token_type)))) throw new Error("the sign-in service did not return a GitHub token");
          var life = typeof j.expires_in === "number" && j.expires_in > 0 ? Math.min(j.expires_in, TOKEN_LIFE) : TOKEN_LIFE;
          return { token: j.access_token, exp: Date.now() + life * 1000 };
        });
      });
  }
  function finishSignIn(r) {
    return exchange(r.code, r.keep.verifier).then(function (tok) {
      return verify(tok.token).then(function () {
        A.exp = tok.exp;
        writeSession(tok.token, tok.exp, r.keep.remember);
        A.authError = "";
        A.pending = []; A.branchOK = false;
        var p = own(r.keep.pending);
        if (p.login === A.user.login) A.pending = cleanOps(p.ops);       // changes made before the sign-in ran out
      });
    }).then(null, function (e) {
      A.token = ""; A.user = null; A.canEdit = false;
      A.authError = "sign-in failed: " + (e.message || e);
    });
  }
  function signOut() {
    clearTimeout(A.timer);
    forgetSession();
    A.token = ""; A.exp = 0; A.user = null; A.canEdit = false; A.repo = null; A.pending = []; A.pendingLogin = ""; A.branchOK = false; A.authError = "";
    TEMP = Object.create(null); UNDO.length = 0; REDO.length = 0;      // a visitor sees the whole network again
    setSave("idle", "");
    return load();
  }
  function init() {
    var started;
    if (RETURN && RETURN.ok && !signInBlock()) started = finishSignIn(RETURN);
    else {
      if (RETURN) A.authError = RETURN.ok ? signInBlock() : RETURN.problem;
      var s = readSession();
      if (s && s.exp <= Date.now()) { forgetSession(); s = null; A.authError = A.authError || EXPIRED; }
      started = s && CFG.ok ? verify(s.t).then(function () { A.exp = s.exp; }, function (e) {
        if (e.status !== 401) A.authError = "could not check the sign-in with GitHub (" + (e.message || e) + ")";
      }) : Promise.resolve();
    }
    return started.then(load).then(function () { if (A.pending.length && A.canEdit) schedule(); });
  }
  setInterval(function () { if (A.token && A.exp && Date.now() > A.exp) expire(); }, 60000);   // the token runs out after ~8 h

  // ------------------------------------------------------------------ what the page asks
  window.Annot = {
    cfg: CFG, kinds: KINDS, stateRe: STATE, idRe: STEP_REF, cleanSmiles: smiles,
    init: init, reload: function () { return A.saving || A.pending.length ? Promise.resolve() : load(); },
    signIn: startSignIn, signOut: signOut, saveNow: save,
    onChange: function (f) { A.listeners.push(f); },
    get user() { return A.user; }, get hasPush() { return !!(A.user && A.canEdit); },
    get canEdit() { return !!(A.user && A.canEdit && A.loaded); }, get loaded() { return A.loaded; },
    get loading() { return !!A.loading; }, get error() { return A.error; }, get authError() { return A.authError || ""; },
    get signInNote() { return signInBlock(); }, get signInReady() { return !signInBlock(); },
    get rememberAllowed() { return location.protocol !== "file:"; }, get leaving() { return A.leaving; },
    get source() { return A.source; }, get saveState() { return A.save; }, get expires() { return A.exp; },
    get pending() { return A.pending.length; }, get loadedAt() { return A.loadedAt; },
    takeNotice: function () { var n = A.notice; A.notice = ""; return n; },          // shown once
    takeRemap: function () { var r = A.lastRemap || {}; A.lastRemap = {}; return r; },
    doc: function () { return A.local; },
    statusOf: function (key) { return has(A.local.status, key) ? A.local.status[key] : null; },
    removed: function (key) { return typeof key === "string" && TEMP[key] ? TEMP[key] : null; },        // this page only
    removedKeys: function (ch) { return Object.keys(TEMP).filter(function (k) { return !ch || k.slice(0, 2) === ch + "|"; }).sort(); },
    isUser: function (id) { return has(A.local.species, id) || has(A.local.steps, id) || has(A.local.mechanisms, id); },
    nextId: function (kind) { return nextId(A.local, kind); },
    setStatus: function (keys, s, note) {
      return push(keys.filter(function (k) { return KEY.test(k); }).map(function (k) {
        return { t: "status", key: k, s: s === "yes" || s === "no" ? s : null, note: s ? text(note, 300) : "" };
      }));
    },
    /* take out of / put back in the network: this page only (until a reload), one undo step for all the keys */
    remove: function (keys, note) {
      return push(keys.filter(function (k) { return KEY.test(k) && !TEMP[k]; }).map(function (k) { return { t: "remove", key: k, note: text(note, 300) }; }));
    },
    restore: function (keys) { return push(keys.filter(function (k) { return KEY.test(k) && !!TEMP[k]; }).map(function (k) { return { t: "restore", key: k }; })); },
    add: function (kind, item) {
      if (!has(KINDS, kind) || !A.user || !A.canEdit || !A.loaded) return null;
      var id = nextId(A.local, kind), it = cleanItem(kind, Object.assign({}, item, { by: A.user.login }));
      if (!it) return null;
      it.uid = uid(); it.at = now();
      push([{ t: "add", kind: kind, id: id, item: it }]);
      return id;
    },
    del: function (kind, id) {
      var it = has(KINDS, kind) && has(A.local[kind], id) ? A.local[kind][id] : null;
      if (!it || !A.user || it.by !== A.user.login) return false;
      return push([{ t: "delete", kind: kind, id: id, uid: it.uid }]);
    },
    json: function () { return JSON.stringify(sortKeys(A.local), null, 1) + "\n"; },
    undo: function () { var ops = UNDO.pop(); if (!ops) return false; if (push(clone(ops), "undo")) return true; UNDO.push(ops); return false; },
    redo: function () { var ops = REDO.pop(); if (!ops) return false; if (push(clone(ops), "redo")) return true; REDO.push(ops); return false; },
    canUndo: function () { return UNDO.length > 0 && !!A.user && !!A.canEdit && !!A.loaded; },
    canRedo: function () { return REDO.length > 0 && !!A.user && !!A.canEdit && !!A.loaded; }
  };
  document.addEventListener("visibilitychange", function () {      // pick up the others' changes when coming back
    if (document.visibilityState === "visible" && A.loaded && !A.saving && !A.pending.length && Date.now() - A.loadedAt > 60000) load();
  });
})();
