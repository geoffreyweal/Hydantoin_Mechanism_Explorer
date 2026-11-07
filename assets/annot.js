/* Hydantoin Mechanism Explorer: the collaborators' votes and edits (window.Annot).

   Everything is kept in one file, annotations.json, on its own branch of the site's GitHub repository (config.js):
     votes[ch|id][login] = {v: "yes"|"no", note, at}      a step, mechanism or species, per chalcogen ("S|S7b")
     removed[ch|id]      = {by, at, note}                  a mechanism or step taken out of the network
     species[UIn], steps[USn], mechanisms[Un]              added by a collaborator ({..., ch: ["O","S"], by, at, uid})
   Anyone can read it (raw.githubusercontent.com). Signing in needs a GitHub personal access token: it is kept in this
   browser (sessionStorage, or localStorage when "remember" is ticked) and is sent only to api.github.com. Only users
   with push access to the repository can vote or edit.

   Each click becomes an operation in a queue. About 2 s after the last click the queue is applied to the file and
   saved as one commit (Contents API). If someone else saved in between (409/422), the file is read again, the same
   operations are applied to it again (each user only ever changes their own votes, so the last writer wins for
   that user's entries) and the save is retried. Everything read from the file is checked and cleaned first. */
(function () {
  "use strict";
  var API = "https://api.github.com", RAW = "https://raw.githubusercontent.com", TOKEN_KEY = "hme.github.token";
  var LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, KEY = /^[OS]\|[A-Za-z][A-Za-z0-9_.-]{0,39}$/, UID = /^[a-z0-9]{6,32}$/;
  var SPID = "[A-Za-z][A-Za-z0-9_.-]{0,39}", STATE = new RegExp("^(?:\\d{1,2} )?" + SPID + "(?: \\+ (?:\\d{1,2} )?" + SPID + "){0,7}$");
  var KINDS = { species: { prefix: "UI", re: /^UI\d{1,5}$/, word: "species" }, steps: { prefix: "US", re: /^US\d{1,5}$/, word: "step" },
                mechanisms: { prefix: "U", re: /^U\d{1,5}$/, word: "mechanism" } };
  var STEP_REF = new RegExp("^" + SPID + "$"), TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?Z$/;
  var DEBOUNCE = 2000, RETRIES = 4;
  function has(o, k) { return !!o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); }
  /* In a frame (another site showing this page), no sign-in and no stored token: a framing page could otherwise
     trick a collaborator into clicking vote or edit buttons. */
  var FRAMED = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();

  // ------------------------------------------------------------------ where the file is
  var CFG = (function () {
    var src = window.HME_CONFIG || {}, c = {};
    ["owner", "repo", "branch", "file"].forEach(function (k) { c[k] = typeof src[k] === "string" ? src[k].trim() : ""; });
    var host = /^([A-Za-z0-9-]+)\.github\.io$/i.exec(location.hostname || ""), seg = (location.pathname || "/").split("/")[1] || "";
    if (host && seg && !/\.html?$/i.test(seg)) {
      c.owner = host[1];
      try { c.repo = decodeURIComponent(seg); } catch (e) { c.repo = seg; }
    }
    c.branch = c.branch || "annotations";
    c.file = c.file || "annotations.json";
    c.ok = LOGIN.test(c.owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(c.repo) && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(c.branch) &&
      /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(c.file);
    return c;
  })();
  function repoPath() { return "/repos/" + CFG.owner + "/" + CFG.repo; }
  function contentsPath() { return repoPath() + "/contents/" + CFG.file.split("/").map(encodeURIComponent).join("/"); }

  // ------------------------------------------------------------------ state
  var A = {
    token: "", user: null, canEdit: false, repo: null, branchOK: false,
    remote: empty(), sha: null, local: empty(), loaded: false, loadedAt: 0, source: "", error: "", broken: false,
    pending: [], saving: false, timer: null, save: { state: "idle", msg: "" }, notice: "", listeners: []
  };
  function empty() { return { format: "hydantoin-mechanism-annotations", version: 1, votes: {}, removed: {}, species: {}, steps: {}, mechanisms: {} }; }
  function now() { return new Date().toISOString(); }
  function uid() {
    var a = new Uint8Array(9), s = "";
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
    return s + Date.now().toString(36);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function emit() {
    A.listeners.forEach(function (f) { try { f(); } catch (e) { if (window.console) console.error(e); } });
  }

  // ------------------------------------------------------------------ the token (never leaves this browser except to api.github.com)
  function readToken() {
    if (FRAMED) return "";
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function writeToken(t, remember) {
    try {
      sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
    } catch (e) { /* storage blocked: signed in for this page only */ }
  }
  function forgetToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch (e) { /* nothing stored */ }
  }

  // ------------------------------------------------------------------ GitHub REST API
  function api(method, path, body) {
    if (!/^\/[A-Za-z0-9_.\/%?=&,-]*$/.test(path)) return Promise.reject(new Error("bad API path"));
    var h = { Accept: "application/vnd.github+json" };
    if (A.token) h.Authorization = "Bearer " + A.token;
    if (body !== undefined) h["Content-Type"] = "application/json";
    return fetch(API + path, { method: method, headers: h, cache: "no-store", credentials: "omit",
                               body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          if (!r.ok) {
            var msg = j && typeof j.message === "string" ? j.message.slice(0, 200) : "HTTP " + r.status;
            var err = new Error(msg);
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
  function clean(raw) {
    var d = empty();
    raw = own(raw);
    var V = own(raw.votes);
    Object.keys(V).forEach(function (k) {
      if (!KEY.test(k)) return;
      var per = own(V[k]);
      Object.keys(per).forEach(function (u) {
        var e = own(per[u]);
        if (!LOGIN.test(u) || (e.v !== "yes" && e.v !== "no")) return;
        (d.votes[k] = d.votes[k] || {})[u] = { v: e.v, note: text(e.note, 300), at: time(e.at) };
      });
    });
    var R = own(raw.removed);
    Object.keys(R).forEach(function (k) {
      var e = own(R[k]);
      if (KEY.test(k) && LOGIN.test(e.by || "")) d.removed[k] = { by: e.by, at: time(e.at), note: text(e.note, 300) };
    });
    function added(kind, check) {
      var src = own(raw[kind]);
      Object.keys(src).forEach(function (id) {
        var e = own(src[id]);
        if (!KINDS[kind].re.test(id) || !LOGIN.test(e.by || "") || !text(e.name, 120) || !chs(e.ch).length) return;
        var item = { uid: UID.test(e.uid || "") ? e.uid : "x" + id.toLowerCase() + "000000", name: text(e.name, 120), ch: chs(e.ch), by: e.by, at: time(e.at) };
        if (check(e, item) !== false) d[kind][id] = item;
      });
    }
    added("species", function (e, it) { it.smiles = smiles(e.smiles); it.note = text(e.note, 300); });
    added("steps", function (e, it) {
      it.from = state(e.from); it.to = state(e.to); it.desc = text(e.desc, 1000);
      return !!(it.from && it.to);
    });
    added("mechanisms", function (e, it) {
      it.desc = text(e.desc, 1000); it.product = state(e.product);
      it.hops = (Array.isArray(e.hops) ? e.hops : []).slice(0, 200).map(function (h) {
        h = own(h);
        var step = h.step === null || h.step === undefined ? null : (typeof h.step === "string" && STEP_REF.test(h.step) ? h.step : false);
        var hop = { step: step, dir: h.dir === "rev" ? "rev" : "fwd", from: state(h.from), to: state(h.to) };
        return step === false || !hop.from || !hop.to ? null : hop;
      });
      if (!it.hops.length || it.hops.some(function (h) { return !h; })) return false;
      it.path = (Array.isArray(e.path) ? e.path : []).slice(0, 401).filter(function (t) { return state(t) || (typeof t === "string" && STEP_REF.test(t)); });
    });
    return d;
  }
  function smiles(x) { var s = text(x, 300); return /^[A-Za-z0-9@+\-\[\]()\\\/%=#$:.*~]*$/.test(s) ? s : ""; }
  function parseDoc(t) {
    var j;
    if (!String(t).trim()) return empty();               // an empty file: no annotations yet
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
      if (op.t === "vote") {
        k = m.key(op.key);
        if (op.v) (d.votes[k] = d.votes[k] || {})[login] = { v: op.v, note: op.note || "", at: op.at };
        else if (d.votes[k]) { delete d.votes[k][login]; if (!Object.keys(d.votes[k]).length) delete d.votes[k]; }
      } else if (op.t === "remove") {
        d.removed[m.key(op.key)] = { by: login, at: op.at, note: op.note || "" };
      } else if (op.t === "restore") {
        delete d.removed[m.key(op.key)];
      } else if (op.t === "add") {
        var coll = d[op.kind], id = op.id, item = clone(op.item);
        if (coll[id] && coll[id].uid !== item.uid) { remap[op.id] = id = nextId(d, op.kind); m = mapper(remap); }
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
          ["O", "S"].forEach(function (ch) { delete d.votes[ch + "|" + cid]; delete d.removed[ch + "|" + cid]; });
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
  function recompute() {
    A.local = A.user ? applyOps(A.remote, A.pending, A.user.login).doc : clone(A.remote);
  }
  function describe(ops, remap) {
    var parts = [], idx = {}, m = mapper(remap);
    ops.forEach(function (op) {
      var id, ch = "", what = "";
      if (op.key) { var q = m.key(op.key).split("|"); ch = q[0]; id = q[1]; } else id = op.id ? m.id(op.id) : "";
      if (op.t === "vote") what = op.v === "yes" ? "possible" : op.v === "no" ? "not possible" : "vote cleared";
      var k = op.t + "|" + (op.kind || "") + "|" + id + "|" + what;
      if (!idx[k]) { idx[k] = { t: op.t, kind: op.kind, id: id, what: what, chs: [] }; parts.push(idx[k]); }
      if (ch && idx[k].chs.indexOf(ch) < 0) idx[k].chs.push(ch);
    });
    var txt = parts.map(function (p) {
      var c = p.chs.length ? " (" + p.chs.sort().join(", ") + ")" : "";
      if (p.t === "vote") return p.id + c + " " + p.what;
      if (p.t === "remove") return "removed " + p.id + c;
      if (p.t === "restore") return "restored " + p.id + c;
      if (p.t === "add") return "added " + KINDS[p.kind].word + " " + p.id;
      return "deleted " + KINDS[p.kind].word + " " + p.id;
    });
    var out = (parts.every(function (p) { return p.t === "vote"; }) ? "Votes" : "Annotations") + " by @" + A.user.login + ": ";
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
        if (e.status === 404) return { doc: empty(), sha: null };          // no branch or no file yet: no annotations
        throw e;
      });
    }
    var url = RAW + "/" + CFG.owner + "/" + CFG.repo + "/" + CFG.branch + "/" + CFG.file;
    return fetch(url, { cache: "no-cache", credentials: "omit" })
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
    var batch = A.pending.slice(), tries = 0;
    A.saving = true;
    setSave("saving", "saving…");
    function attempt() {
      var res = applyOps(A.remote, batch, A.user.login), body = {
        message: describe(batch, res.remap),
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
      var msg = e.status === 401 ? "GitHub no longer accepts the token: sign in again" :
        e.status === 409 || e.status === 422 ? CFG.file + " kept changing on GitHub while saving; press retry (GitHub: " + e.message + ")" :
        e.status === 403 || e.status === 404 ? "GitHub refused the save (" + e.message + "); does the token have Contents: Read and write on " + CFG.repo + "?" :
        e.message || String(e);
      recompute();
      setSave("error", msg);
    });
  }
  function push(ops) {
    if (!A.user || !A.canEdit || !A.loaded) return false;      // never edit a file that could not be read
    var at = now();
    ops.forEach(function (op) { op.at = at; A.pending.push(op); });
    recompute();
    schedule();
    emit();
    return true;
  }

  // ------------------------------------------------------------------ signing in and out
  function verify(t) {
    A.token = t;
    return api("GET", "/user").then(function (u) {
      if (!u || !LOGIN.test(u.login || "")) { var x = new Error("GitHub did not return a user for this token"); x.badToken = true; throw x; }
      A.user = { login: u.login, name: text(u.name, 100) };
      return api("GET", repoPath()).then(function (r) {
        A.repo = r || {};
        A.canEdit = !!(r && r.permissions && r.permissions.push);
      }, function (e) {
        if (e.status !== 404) throw e;
        A.repo = {}; A.canEdit = false;
      });
    }).then(null, function (e) {
      A.token = ""; A.user = null; A.canEdit = false;
      if (e.status === 401) { var x = new Error("GitHub did not accept this token (wrong, expired or revoked)"); x.badToken = true; throw x; }
      throw e;
    });
  }
  function signIn(t, remember) {
    if (FRAMED) return Promise.reject(new Error("Open the site in its own tab to sign in."));
    t = String(t || "").trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(t)) return Promise.reject(new Error("That does not look like a GitHub token (ghp_… or github_pat_…)"));
    if (!CFG.ok) return Promise.reject(new Error("No repository is set in assets/config.js"));
    return verify(t).then(function () {
      writeToken(t, remember);
      A.pending = []; A.branchOK = false;
      return load();
    }).then(function () { emit(); return A.user; });
  }
  function signOut() {
    clearTimeout(A.timer);
    forgetToken();
    A.token = ""; A.user = null; A.canEdit = false; A.repo = null; A.pending = []; A.branchOK = false;
    setSave("idle", "");
    return load();
  }
  function init() {
    var t = readToken();
    if (!t || !CFG.ok) return load();
    return verify(t).then(load, function (e) {
      if (e.badToken) {                       // the token is no good: forget it
        forgetToken();
        A.authError = "GitHub no longer accepts the saved token";
      } else {                                // offline or GitHub unreachable: keep the token for next time
        A.authError = "could not check the sign-in with GitHub (" + (e.message || e) + ")";
      }
      return load();
    });
  }

  // ------------------------------------------------------------------ what the page asks
  function status(key) {
    var V = has(A.local.votes, key) ? A.local.votes[key] : {}, yes = 0, no = 0, list = [];
    Object.keys(V).forEach(function (u) {
      if (V[u].v === "yes") yes++; else no++;
      list.push({ login: u, v: V[u].v, note: V[u].note, at: V[u].at });
    });
    list.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    return { state: !yes && !no ? "none" : yes > no ? "yes" : no > yes ? "no" : "tie", yes: yes, no: no, votes: list,
             mine: A.user && has(V, A.user.login) ? V[A.user.login] : null };
  }
  window.Annot = {
    cfg: CFG, kinds: KINDS, stateRe: STATE, idRe: STEP_REF, cleanSmiles: smiles,
    init: init, reload: function () { return A.saving || A.pending.length ? Promise.resolve() : load(); },
    signIn: signIn, signOut: signOut, saveNow: save,
    onChange: function (f) { A.listeners.push(f); },
    get user() { return A.user; }, get hasPush() { return !!(A.user && A.canEdit); },
    get canEdit() { return !!(A.user && A.canEdit && A.loaded); }, get loaded() { return A.loaded; },
    get loading() { return !!A.loading; }, get error() { return A.error; }, get authError() { return A.authError || ""; },
    get source() { return A.source; }, get saveState() { return A.save; },
    get pending() { return A.pending.length; }, get loadedAt() { return A.loadedAt; },
    takeNotice: function () { var n = A.notice; A.notice = ""; return n; },          // shown once
    takeRemap: function () { var r = A.lastRemap || {}; A.lastRemap = {}; return r; },
    get rememberAllowed() { return location.protocol !== "file:"; },
    get signInAllowed() { return !FRAMED && CFG.ok; },
    doc: function () { return A.local; },
    status: status,
    removed: function (key) { return has(A.local.removed, key) ? A.local.removed[key] : null; },
    isUser: function (id) { return has(A.local.species, id) || has(A.local.steps, id) || has(A.local.mechanisms, id); },
    nextId: function (kind) { return nextId(A.local, kind); },
    vote: function (keys, v, note) {
      return push(keys.map(function (k) { return { t: "vote", key: k, v: v === "yes" || v === "no" ? v : null, note: text(note, 300) }; }));
    },
    remove: function (keys, note) { return push(keys.map(function (k) { return { t: "remove", key: k, note: text(note, 300) }; })); },
    restore: function (keys) { return push(keys.map(function (k) { return { t: "restore", key: k }; })); },
    add: function (kind, item) {
      if (!KINDS[kind] || !A.user || !A.canEdit || !A.loaded) return null;
      var id = nextId(A.local, kind), it = clone(item);
      it.uid = uid(); it.by = A.user.login; it.at = now();
      push([{ t: "add", kind: kind, id: id, item: it }]);
      return id;
    },
    del: function (kind, id) {
      var it = KINDS[kind] && has(A.local[kind], id) ? A.local[kind][id] : null;
      if (!it || !A.user || it.by !== A.user.login) return false;
      return push([{ t: "delete", kind: kind, id: id, uid: it.uid }]);
    },
    json: function () { return JSON.stringify(sortKeys(A.local), null, 1) + "\n"; }
  };
  document.addEventListener("visibilitychange", function () {      // pick up the others' votes when coming back
    if (document.visibilityState === "visible" && A.loaded && !A.saving && !A.pending.length && Date.now() - A.loadedAt > 60000) load();
  });
})();
