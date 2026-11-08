/* Hydantoin Mechanism Explorer: mechanisms, network, species and steps of the two mechflow projects (Ch_O, Ch_S),
   with the collaborators' statuses and edits (annot.js) and the filtered or edited network (netgraph.js).
   A collaborator marks a mechanism or a step possible or not possible (one status per item, per chalcogen). A step
   marked not possible makes every mechanism that uses it not possible, unless the mechanism has its own mark: marked
   possible, it is then shown as a conflict. Text written by collaborators (names, notes, SMILES, logins) is only ever
   put on the page as text (textContent, or esc() in HTML strings), never as HTML. */
(function () {
  "use strict";
  var S = { ch: "O", tab: "mech", mech: null, zoom: null, top: 100, both: false, netMode: "all", netRemoved: false, ts3d: false, builder: null };
  var MODES = ["all", "grey", "hide"];          // network: everything / grey out what is not possible / hide it
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var CHN = { O: "urea", S: "thiourea" };
  var WORD = { none: "unmarked", yes: "possible", no: "not possible", conflict: "conflict" };
  var TABS = ["mech", "net", "species", "steps", "annot", "about"];
  var NODRAW = "No drawing for this step yet: rebuild the website (make_website.py) to draw it.";

  (function prefs() {                    // per-viewer conveniences only
    try {
      var p = JSON.parse(localStorage.getItem("hme.prefs") || "{}");
      S.both = p.both === true; S.netRemoved = p.netRemoved === true;
      if (MODES.indexOf(p.netMode) >= 0) S.netMode = p.netMode;
      S.ts3d = p.ts3d === true;
    } catch (e) { /* no storage */ }
  })();
  function savePrefs() {
    try { localStorage.setItem("hme.prefs", JSON.stringify({ both: S.both, netMode: S.netMode, netRemoved: S.netRemoved, ts3d: S.ts3d })); } catch (e) { /* no storage */ }
  }

  // ------------------------------------------------------------------ data files loaded on demand (works from file://)
  function load(kind, ch, id) {
    return new Promise(function (res, rej) {
      var key = kind + "/" + ch + "/" + id;
      if (__cache[key] !== undefined) { res(__cache[key]); return; }
      (__wait[key] = __wait[key] || []).push(res);
      if (__wait[key].length > 1) return;
      var s = document.createElement("script");
      s.src = "data/" + kind + "/" + ch + "/" + encodeURIComponent(id) + ".js";
      s.onerror = function () { delete __wait[key]; rej(new Error("no data for " + key)); };
      document.head.appendChild(s);
    });
  }
  function M() { return META.ch[S.ch]; }
  /* IDs can come from the address (#m=...), from annotations.json or from the network, so they are looked up only
     as own properties ("constructor" is not a mechanism) */
  function has(o, k) { return !!o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); }
  function baseMech(id, ch) { var m = META.ch[ch || S.ch].mechanisms; return has(m, id) ? m[id] : null; }
  function baseStep(id, ch) { var m = META.ch[ch || S.ch].steps; return has(m, id) ? m[id] : null; }
  function baseSpecies(id, ch) { var m = META.ch[ch || S.ch].species; return has(m, id) ? m[id] : null; }
  function xyzOf(id, ch) { var x = XYZ[ch || S.ch]; return has(x, id) ? x[id] : null; }
  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function nat(a, b) { return String(a).localeCompare(String(b), "en", { numeric: true }); }
  function chText(t) {
    var O = S.ch === "O";
    return String(t).replace(/iso\(thio\)urea/g, O ? "isourea" : "isothiourea").replace(/pseudo\(thio\)hydantoin/g, O ? "pseudohydantoin" : "pseudothiohydantoin")
      .replace(/iso\(thio\)cyanate/g, O ? "isocyanate" : "isothiocyanate").replace(/\(thio\)urea/g, O ? "urea" : "thiourea")
      .replace(/\(thio\)ureido/g, O ? "ureido" : "thioureido").replace(/O\/S-containing/g, O ? "O-containing" : "S-containing")
      .replace(/O\/S/g, O ? "O" : "S").replace(/imino-azolidin/g, O ? "imino-oxazolidin" : "imino-thiazolidin");
  }
  /* h("div", {class: "x", title: userText}, [child, "text"]): elements built without HTML parsing */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); });
    return el;
  }
  function day(at) { return at ? at.slice(0, 10) : ""; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function chList(chs) { return chs.map(function (c) { return CHN[c] + " (" + c + ")"; }).join(" and "); }
  function toast(msg) {
    var t = h("div", { class: "toast", role: "status" }, [msg]);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3200);
    setTimeout(function () { t.remove(); }, 3800);
  }

  // ------------------------------------------------------------------ the collaborators' annotations
  function doc() { return Annot.doc(); }
  function key(ch, id) { return ch + "|" + id; }
  function userMech(id) { return has(doc().mechanisms, id) ? doc().mechanisms[id] : null; }
  function userStep(id) { return has(doc().steps, id) ? doc().steps[id] : null; }
  function userSpecies(id) { return has(doc().species, id) ? doc().species[id] : null; }
  function exists(id, ch) {
    var u = userMech(id) || userStep(id) || userSpecies(id);
    return u ? u.ch.indexOf(ch) >= 0 : !!(baseStep(id, ch) || baseMech(id, ch) || baseSpecies(id, ch));
  }
  function isMech(id, ch) { var u = userMech(id); return u ? u.ch.indexOf(ch) >= 0 : !!baseMech(id, ch); }
  function isStep(id, ch) { var u = userStep(id); return u ? u.ch.indexOf(ch) >= 0 : !!baseStep(id, ch); }

  // ------------------------------------------------------------------ statuses: own marks, spread from steps to mechanisms
  function ownStatus(id, ch) { return Annot.statusOf(key(ch, id)); }          // {s: "yes"|"no", note, by, at} or null
  function mechSteps(mid, ch) {                     // the steps a mechanism goes through (each once)
    var u = userMech(mid), b = u ? null : baseMech(mid, ch), out = [];
    (u ? u.hops.map(function (x) { return x.step; }) : b ? b.steps : []).forEach(function (s) { if (s && out.indexOf(s) < 0) out.push(s); });
    return out;
  }
  /* {state: "yes"|"no"|"conflict"|"none", own: the item's own mark or null, from: "own"|"steps"|"", steps: [...]}
     steps: for "no" from steps and for "conflict", the steps marked not possible */
  function mechStatus(mid, ch) {
    var o = ownStatus(mid, ch), steps = mechSteps(mid, ch);
    var no = steps.filter(function (s) { var x = ownStatus(s, ch); return !!x && x.s === "no"; });
    if (o && o.s === "no") return { state: "no", own: o, from: "own", steps: [] };
    if (o && o.s === "yes") return no.length ? { state: "conflict", own: o, from: "own", steps: no } : { state: "yes", own: o, from: "own", steps: [] };
    if (no.length) return { state: "no", own: null, from: "steps", steps: no };
    if (steps.length && steps.every(function (s) { var x = ownStatus(s, ch); return !!x && x.s === "yes"; })) return { state: "yes", own: null, from: "steps", steps: steps };
    return { state: "none", own: null, from: "", steps: [] };
  }
  function stepStatus(sid, ch) { var o = ownStatus(sid, ch); return { state: o ? o.s : "none", own: o, from: o ? "own" : "", steps: [] }; }
  function shownStatus(id, ch) { return isMech(id, ch) ? mechStatus(id, ch) : isStep(id, ch) ? stepStatus(id, ch) : { state: "none", own: null, from: "", steps: [] }; }
  function few(a) { return a.slice(0, 3).join(", ") + (a.length > 3 ? " +" + (a.length - 3) : ""); }
  function statusText(st) {                          // "possible", "not possible: S7b", "conflict: S7b"
    if (st.state === "no") return st.from === "steps" ? "not possible: " + few(st.steps) : "not possible";
    if (st.state === "conflict") return "conflict: " + few(st.steps);
    return WORD[st.state];
  }
  function who(o) { return "@" + o.by + (o.at ? " on " + day(o.at) : "") + (o.note ? ": " + o.note : ""); }
  function statusSource(st, ch) {                    // where the status comes from, in words
    if (st.state === "none") return "";
    if (st.from === "own" && st.state !== "conflict") return "Marked " + WORD[st.own.s] + " by " + who(st.own) + ".";
    if (st.state === "conflict") return "Marked possible by " + who(st.own) + ", but " + st.steps.join(", ") + (st.steps.length > 1 ? " are" : " is") + " marked not possible.";
    if (st.state === "no") return "Not possible because " + st.steps.map(function (s) { var x = ownStatus(s, ch); return s + " is marked not possible (" + who(x) + ")"; }).join("; ") + ".";
    return "Possible because every one of its steps is marked possible.";
  }
  function badge(id, ch) {                           // the shown status and "removed", for the lists (HTML, escaped)
    var st = shownStatus(id, ch), rm = Annot.removed(key(ch, id)), out = "";
    if (st.state !== "none") out += "<span class='bdg st-" + st.state + "' title='" + esc(statusSource(st, ch)) + "'>" + esc(statusText(st)) + "</span>";
    if (rm) out += "<span class='bdg rmv' title='" + esc("removed from the network by @" + rm.by + (rm.note ? ": " + rm.note : "")) + "'>removed</span>";
    return out;
  }
  function mechsUsing(sid, ch) {                     // the mechanisms (built-in and added) that use a step
    var st = baseStep(sid, ch), out = (st ? st.used_by : []).filter(function (m) { return baseMech(m, ch); });
    Object.keys(doc().mechanisms).forEach(function (m) { if (isMech(m, ch) && mechSteps(m, ch).indexOf(sid) >= 0 && out.indexOf(m) < 0) out.push(m); });
    return out;
  }

  // the status buttons of a step or a mechanism (and "remove from network"), refreshed when the annotations change
  function statusWidget(id, ch, kind) {
    var el = h("div", { class: "vote", "data-id": id, "data-ch": ch, "data-kind": kind }, [
      h("span", { class: "chip" }),
      h("span", { class: "vctl" }, [
        h("button", { class: "vb yes", "data-v": "yes", title: "mark as possible" }, ["✓ possible"]),
        h("button", { class: "vb no", "data-v": "no", title: "mark as not possible" }, ["✗ not possible"]),
        h("button", { class: "vb clr", "data-v": "clear", title: "take the mark away" }, ["clear"]),
        h("input", { class: "vnote", type: "text", maxlength: "300", placeholder: "short note (optional)", "aria-label": "note" }),
        h("label", { class: "vboth", title: "apply to the urea and the thiourea" }, [h("input", { type: "checkbox" }), " urea and thiourea"]),
        h("button", { class: "vrm", title: "take it out of the network (or put it back)" }, ["remove from network"])
      ]),
      h("span", { class: "vhint" }),
      h("div", { class: "vsrc" }),
      h("div", { class: "vrmd" })
    ]);
    $(".vnote", el).addEventListener("input", function () { el._typed = true; });
    renderStatus(el);
    return el;
  }
  function renderStatus(el) {
    var id = el.getAttribute("data-id"), ch = el.getAttribute("data-ch"), kind = el.getAttribute("data-kind"), k = key(ch, id);
    var st = kind === "mech" ? mechStatus(id, ch) : stepStatus(id, ch), mine = ownStatus(id, ch), rm = Annot.removed(k);
    var edit = Annot.canEdit && exists(id, ch), chip = $(".chip", el);
    chip.className = "chip st-" + st.state;
    chip.textContent = statusText(st);
    $(".vctl", el).hidden = !edit;
    $$(".vb", el).forEach(function (b) {
      var on = !!mine && mine.s === b.getAttribute("data-v");
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $(".vb.clr", el).disabled = !mine;
    var vn = $(".vnote", el);              // the note of the mark, until someone starts typing a new one
    if (!el._typed && document.activeElement !== vn) vn.value = mine ? mine.note || "" : "";
    $(".vboth input", el).checked = S.both;
    var rb = $(".vrm", el);
    rb.textContent = rm ? "restore to network" : "remove from network"; rb.classList.toggle("on", !!rm);
    $(".vhint", el).textContent = edit ? "" : !Annot.loaded ? (Annot.error ? "annotations unavailable" : "loading…") :
      !Annot.user ? (Annot.signInReady ? "Sign in (top right) to mark it." : "") :
      !Annot.hasPush ? "@" + Annot.user.login + " has no push access, so this is read only" : "";
    var src = statusSource(st, ch);
    if (kind === "step" && mine && mine.s === "no") {
      var ms = mechsUsing(id, ch);
      if (ms.length) src += " This makes " + few(ms) + (ms.length > 1 ? " (" + ms.length + " mechanisms)" : "") + " not possible unless marked otherwise.";
    }
    $(".vsrc", el).textContent = src;
    $(".vsrc", el).hidden = !src;
    var rmd = $(".vrmd", el);
    rmd.hidden = !rm;
    rmd.textContent = rm ? "Removed from the network (" + CHN[ch] + ") by @" + rm.by + (rm.at ? " on " + day(rm.at) : "") + (rm.note ? ": " + rm.note : "") : "";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".vote button");
    if (!b || !Annot.canEdit) return;
    var el = b.closest(".vote"), id = el.getAttribute("data-id"), ch = el.getAttribute("data-ch");
    var keys = ($(".vboth input", el).checked ? ["O", "S"] : [ch]).filter(function (c) { return exists(id, c); }).map(function (c) { return key(c, id); });
    var note = $(".vnote", el).value;
    el._typed = false;
    if (b.classList.contains("vrm")) {
      if (Annot.removed(key(ch, id))) Annot.restore(keys.filter(function (k) { return Annot.removed(k); }));
      else Annot.remove(keys, note);
    } else if (b.getAttribute("data-v") === "clear") {
      Annot.setStatus(keys.filter(function (k) { return Annot.statusOf(k); }), null, "");
    } else Annot.setStatus(keys, b.getAttribute("data-v"), note);
  });
  document.addEventListener("change", function (e) {
    if (!e.target.matches(".vboth input")) return;
    S.both = e.target.checked;
    savePrefs();
    $$(".vboth input").forEach(function (x) { x.checked = S.both; });
  });

  // ------------------------------------------------------------------ signing in (GitHub App, web flow: see annot.js)
  function renderAuth() {
    var box = $("#auth"), u = Annot.user, st = Annot.saveState;
    box.textContent = "";
    document.body.classList.toggle("can-edit", Annot.canEdit);
    var info = Annot.loading && !Annot.loaded ? "loading annotations…" : !Annot.loaded ? "annotations unavailable" : "";
    if (info) box.appendChild(h("span", { class: "annstate" + (Annot.loaded ? "" : " off"), title: Annot.error || null }, [info]));
    if (u) {
      var until = Annot.expires ? "signed in until " + new Date(Annot.expires).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      box.appendChild(h("span", { class: "who", title: (u.name || u.login) + (until ? " (" + until + ")" : "") }, [h("i", { class: "ini" }, [u.login.charAt(0).toUpperCase()]), "@" + u.login]));
      box.appendChild(h("span", { class: "role " + (Annot.hasPush ? "ok" : "ro"), title: Annot.hasPush ? "push access: can mark and edit" : "no push access to " +
        Annot.cfg.owner + "/" + Annot.cfg.repo }, [Annot.hasPush ? "collaborator" : "read only"]));
      if (Annot.hasPush && st.state !== "idle") {
        var txt = st.state === "error" ? "error: " + st.msg : st.msg;
        box.appendChild(h("span", { class: "save s-" + st.state, title: st.msg }, [txt.length > 70 ? txt.slice(0, 68) + "…" : txt]));
        if (st.state === "error") box.appendChild(h("button", { class: "btn", onclick: function () { Annot.saveNow(); } }, ["retry"]));
      }
      box.appendChild(h("button", { class: "btn", onclick: signOut }, ["Sign out"]));
      return;
    }
    if (Annot.authError) box.appendChild(h("span", { class: "autherr", role: "alert", title: Annot.authError }, [Annot.authError]));
    if (!Annot.signInReady) { box.appendChild(h("span", { class: "signnote", title: Annot.signInNote }, [Annot.signInNote])); return; }
    if (Annot.pending) box.appendChild(h("span", { class: "save s-error" }, [Annot.pending + " unsaved change" + (Annot.pending > 1 ? "s" : "") + ": sign in to save"]));
    var rem = h("input", { type: "checkbox", id: "remember" });
    box.appendChild(h("label", { class: "remember", title: "keep the sign-in in this browser after the tab is closed (about 8 hours)" }, [rem, " remember on this computer"]));
    box.appendChild(h("button", { class: "btn primary", id: "signin", onclick: function (e) {
      e.target.disabled = true;
      Annot.signIn(rem.checked).then(null, function (x) { e.target.disabled = false; toast("Could not sign in: " + x.message); });
    } }, ["Sign in with GitHub"]));
  }
  function signOut() {
    if (Annot.pending && !window.confirm(Annot.pending + " change(s) are not saved yet. Sign out anyway?")) return;
    Annot.signOut();
  }
  window.addEventListener("beforeunload", function (e) { if (Annot.pending && !Annot.leaving) { e.preventDefault(); e.returnValue = ""; } });

  // ------------------------------------------------------------------ xyz helpers
  function frames(txt) {
    var L = txt.split(/\r?\n/), out = [], k = 0;
    while (k < L.length && L[k].trim()) {
      var n = parseInt(L[k], 10), at = [];
      for (var i = 0; i < n; i++) {
        var p = L[k + 2 + i].trim().split(/\s+/);
        at.push({ el: p[0], x: +p[1], y: +p[2], z: +p[3] });
      }
      out.push({ comment: L[k + 1], atoms: at });
      k += n + 2;
    }
    return out;
  }
  function keyAtoms(comment) {
    var out = {}, m = /key atoms:(.*)$/.exec(comment || "");
    if (!m) return out;
    m[1].split(",").forEach(function (part) { var q = part.trim().split(/\s+/); if (q.length === 2) out[+q[0]] = q[1]; });
    return out;
  }
  function toXYZ(f, dx) {
    return f.atoms.length + "\n" + (f.comment || "") + "\n" + f.atoms.map(function (a) {
      return a.el + " " + (a.x + (dx || 0)).toFixed(5) + " " + a.y.toFixed(5) + " " + a.z.toFixed(5);
    }).join("\n") + "\n";
  }

  // ------------------------------------------------------------------ floating windows
  function makeWin(title, sub, w) {
    var d = document.createElement("div");
    d.className = "win";
    var n = $$(".win").length;
    d.style.left = Math.max(8, Math.min(80 + 32 * n, window.innerWidth - 420)) + "px";
    d.style.top = Math.max(8, Math.min(70 + 26 * n, window.innerHeight - 300)) + "px";
    d.style.width = Math.min(w || 820, window.innerWidth - 40) + "px";
    d.style.maxHeight = (window.innerHeight - 40) + "px";
    d.style.zIndex = ++S.top;
    d.innerHTML = "<div class='bar'><b>" + esc(title) + "</b><span class='t'>" + esc(sub || "") + "</span><button title='Close'>&times;</button></div><div class='body'></div>";
    $("#windows").appendChild(d);
    $(".bar button", d).onclick = function () { d.remove(); };
    d.addEventListener("mousedown", function () { d.style.zIndex = ++S.top; });
    var bar = $(".bar", d), sx, sy, ox, oy;
    bar.addEventListener("pointerdown", function (e) {
      if (e.target.tagName === "BUTTON") return;
      sx = e.clientX; sy = e.clientY; ox = d.offsetLeft; oy = d.offsetTop; bar.setPointerCapture(e.pointerId);
      bar.onpointermove = function (ev) { d.style.left = (ox + ev.clientX - sx) + "px"; d.style.top = Math.max(0, oy + ev.clientY - sy) + "px"; };
      bar.onpointerup = function () { bar.onpointermove = null; };
    });
    return $(".body", d);
  }
  function closeWin(body) { var w = body.closest(".win"); if (w) w.remove(); }
  function viewer3d(el) {
    if (!window.$3Dmol) { el.textContent = "The 3D viewer (assets/3Dmol-min.js) is missing from this copy of the site."; throw new Error("3Dmol.js is not loaded"); }
    return window.$3Dmol.createViewer(el, { backgroundColor: "white" });
  }
  function styleAll(v, mode) {
    if (mode === "line") v.setStyle({}, { line: { colorscheme: "Jmol" } });
    else if (mode === "spacefill") v.setStyle({}, { sphere: { colorscheme: "Jmol" } });
    else v.setStyle({}, { stick: { radius: 0.13, colorscheme: "Jmol" }, sphere: { scale: 0.24, colorscheme: "Jmol" } });
  }
  function stateLinks(st) {      // "I2 + UI1" with each species clickable
    var out = [];
    st.split(" + ").forEach(function (t, k) {
      var m = /^(\d+ )?(.+)$/.exec(t);
      if (k) out.push(" + ");
      if (m[1]) out.push(m[1]);
      out.push(h("a", { "data-mol": m[2] }, [m[2]]));
    });
    return out;
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-mol]");
    if (a && a.closest(".win, #mechview, #annot")) openMol([a.getAttribute("data-mol")]);
  });

  // ------------------------------------------------------------------ species in 3D (and the species added by collaborators)
  function openMol(ids) {
    ids.filter(userSpecies).forEach(openUserSpecies);
    ids = ids.filter(function (s) { return xyzOf(s) && baseSpecies(s); });
    if (!ids.length) return;
    var title = ids.join(" + ");
    var names = ids.map(function (s) { return chText(baseSpecies(s).name); }).join(" + ");
    var body = makeWin(title, names + "  (" + CHN[S.ch] + ")", 640);
    body.innerHTML = "<div class='v3d'></div><div class='tools'><button data-a='labels'>Key atoms</button>" +
      "<button data-a='ball'>Ball &amp; stick</button><button data-a='line'>Lines</button><button data-a='spacefill'>Space-filling</button>" +
      "<span class='note'>drag to turn, scroll to zoom</span></div><div class='info'></div>";
    var v = viewer3d($(".v3d", body)), dx = 0, labels = [], show = false;
    ids.forEach(function (sid) {
      var f = frames(xyzOf(sid))[0], xs = f.atoms.map(function (a) { return a.x; });
      var shift = dx - Math.min.apply(null, xs);
      v.addModel(toXYZ(f, shift), "xyz");
      var ka = keyAtoms(f.comment);
      Object.keys(ka).forEach(function (i) { var a = f.atoms[+i]; labels.push([ka[i], a.x + shift, a.y, a.z]); });
      dx += (Math.max.apply(null, xs) - Math.min.apply(null, xs)) + 3.5;
    });
    styleAll(v, "ball"); v.zoomTo(); v.render();
    $(".tools", body).addEventListener("click", function (e) {
      var a = e.target.dataset.a; if (!a) return;
      if (a === "labels") {
        show = !show; v.removeAllLabels();
        if (show) labels.forEach(function (l) { v.addLabel(l[0], { position: { x: l[1], y: l[2], z: l[3] }, fontSize: 11, fontColor: "black", backgroundColor: "white", backgroundOpacity: 0.75, inFront: true }); });
      } else styleAll(v, a);
      v.render();
    });
    var info = ids.map(function (sid) {
      var sp = baseSpecies(sid);
      return "<div><b>" + esc(sid) + "</b> " + esc(chText(sp.name)) + " &middot; " + esc(sp.formula) + " &middot; used by " + sp.used_by.length +
        " mechanisms &middot; <a href='xyz/species/Ch_" + S.ch + "/" + esc(sid) + ".xyz' download>xyz</a></div>";
    }).join("");
    $(".info", body).innerHTML = info + "<div class='note'>Starting structures (force field). Open an xyz file in ASE with <code>ase gui " + esc(ids[0]) + ".xyz</code>.</div>";
  }
  function usersOf(id) {         // the collaborators' steps and mechanisms that use a species or step
    var d = doc(), out = [];
    Object.keys(d.steps).forEach(function (s) {
      var st = d.steps[s];
      if ((st.from + " + " + st.to).split(" + ").some(function (t) { return t.replace(/^\d+ /, "") === id; })) out.push(s);
    });
    Object.keys(d.mechanisms).forEach(function (m) {
      if (d.mechanisms[m].hops.some(function (hp) { return hp.step === id || (hp.from + " + " + hp.to).split(" + ").some(function (t) { return t.replace(/^\d+ /, "") === id; }); })) out.push(m);
    });
    return out;
  }
  function deleteButton(kind, id) {
    var it = has(doc()[kind], id) ? doc()[kind][id] : null;
    if (!it || !Annot.user || it.by !== Annot.user.login || !Annot.canEdit) return null;
    return h("button", { class: "btn danger", onclick: function (e) {
      var used = usersOf(id);
      if (used.length) { toast(id + " is used by " + used.join(", ") + ": delete those first."); return; }
      if (!window.confirm("Delete " + id + " for good? (Removing it from the network can be undone; deleting cannot.)")) return;
      Annot.del(kind, id);
      var w = e.target.closest(".win");
      if (w) w.remove();
    } }, ["delete " + id]);
  }
  function openUserSpecies(id) {
    var u = userSpecies(id);
    if (!u) return;
    var body = makeWin(id, u.name + "  (added by @" + u.by + ")", 560);
    var used = usersOf(id);
    body.appendChild(h("div", { class: "info ucard" }, [
      h("p", null, [h("b", null, ["Name: "]), u.name]),
      h("p", null, [h("b", null, ["SMILES: "]), u.smiles ? h("code", { class: "mono" }, [u.smiles]) : "not given"]),
      u.note ? h("p", null, [u.note]) : null,
      h("p", null, ["Added by @" + u.by + (u.at ? " on " + day(u.at) : "") + " for the " + chList(u.ch) + "."]),
      h("p", null, [h("b", null, ["Used by: "]), used.length ? used.join(", ") : "nothing yet"]),
      h("p", { class: "note" }, ["A species added by a collaborator: there is no structure or calculation for it yet."]),
      deleteButton("species", id)
    ]));
  }

  // ------------------------------------------------------------------ a step: diagram, 3D path (IDPP / ASE NEB), info
  function openStep(sid, dir) {
    if (userStep(sid)) { openUserStep(sid); return; }
    var ch = S.ch, st = baseStep(sid, ch);
    if (!st) return;
    var rev = dir === "rev" && !!st.rev;          // the step as a mechanism uses it backwards: drawn and played that way
    dir = rev ? "rev" : "fwd";
    var body = makeWin(sid + (rev ? " (backwards)" : ""), (rev ? "reverse of: " : "") + chText(st.name) + "  (" + CHN[ch] + ")", 900);
    body.innerHTML = "<div class='tabs'><button data-p='d' class='on'>Diagram</button><button data-p='p'>3D: TS guess and path</button>" +
      (st.dft.length ? "<button data-p='q'>3D: DFT</button>" : "") + "<button data-p='i'>Details</button></div>" +
      "<div class='pane on' data-p='d'><div class='seg tsswitch' role='group' aria-label='TS picture' hidden><button data-ts='2d'>2D</button>" +
      "<button data-ts='3d'>3D</button></div><div class='svgbox'>loading&hellip;</div></div>" +
      "<div class='pane' data-p='p'><div class='v3d'></div><div class='tools'><button data-a='play'>&#9654; Play</button>" +
      "<input type='range' min='0' max='1' value='0' aria-label='image'><span class='fr'></span><button data-a='ts'>TS guess</button>" +
      "<button data-a='labels'>Key atoms</button><a download>path .xyz (ase gui)</a></div>" +
      "<div class='info note'>IDPP path (ASE NEB) between the two sides of the step" + (rev ? ", played backwards" : "") +
      "; TS guess: the image whose scanned distance is nearest a typical TS value. Not a DFT result: <code>ase gui " + esc(sid) + "_path.xyz</code></div></div>" +
      (st.dft.length ? "<div class='pane' data-p='q'><div class='v3d'></div><div class='tools'><input type='range' min='0' value='0'><span class='fr'></span></div></div>" : "") +
      "<div class='pane' data-p='i'><div class='info'></div></div>";
    body.insertBefore(statusWidget(sid, ch, "step"), body.firstChild);
    var tabs = $(".tabs", body);
    tabs.addEventListener("click", function (e) {
      var p = e.target.dataset.p; if (!p) return;
      $$(".tabs button", body).forEach(function (b) { b.classList.toggle("on", b.dataset.p === p); });
      $$(".pane", body).forEach(function (b) { b.classList.toggle("on", b.dataset.p === p); });
      if (p === "p") showPath(); if (p === "q") showDFT();
    });
    // the TS above the arrow: the 2D sketch (.ts2d) or the 3D TS guess (.ts3d), when the drawing has both
    var dBox = $(".pane[data-p=d] .svgbox", body), sw = $(".pane[data-p=d] .tsswitch", body);
    function show3d(on) {
      dBox.classList.toggle("show3d", on);
      $$("button", sw).forEach(function (b) { var o = (b.dataset.ts === "3d") === on; b.classList.toggle("on", o); b.setAttribute("aria-pressed", o ? "true" : "false"); });
    }
    sw.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-ts]"); if (!b) return;
      S.ts3d = b.dataset.ts === "3d"; savePrefs(); show3d(S.ts3d);
    });
    if (st.drawn === false) dBox.textContent = NODRAW;
    else load("step", ch, sid + "_" + dir).then(function (svg) {
      dBox.innerHTML = svg;
      var both = !!dBox.querySelector(".ts3d") && !!dBox.querySelector(".ts2d");
      sw.hidden = !both;
      show3d(both && S.ts3d);
    }).catch(function () { dBox.textContent = "No drawing for this step."; });
    var mechs = st.used_by.filter(function (m) { return baseMech(m, ch); });
    var umechs = usersOf(sid).filter(function (m) { return userMech(m) && userMech(m).ch.indexOf(ch) >= 0; });
    var reaction = rev ? st.reaction.split(" -> ").reverse().join(" -> ") : st.reaction;
    $(".pane[data-p=i] .info", body).innerHTML = "<p><b>Reaction" + (rev ? " (backwards)" : "") + ":</b> " + esc(reaction) +
      (rev ? " <span class='note'>(reverse of " + esc(st.reaction) + ")</span>" : "") + "</p>" +
      "<p><b>SCAN in mechflow:</b> atoms " + st.scan.atoms.join(", ") + " (from " + esc(st.start) + "), " + (st.scan.mode === "stretch" ? "stretched" : "brought together") +
      " from " + st.scan.d0 + " to " + st.scan.to + " &Aring;.</p><p><b>Used by:</b> " +
      (mechs.length ? mechs.map(function (m) { return "<a data-m='" + esc(m) + "'>" + esc(m) + "</a>"; }).join(", ") : "no mechanism") + "</p>" +
      (umechs.length ? "<p><b>Used by mechanisms added by collaborators:</b> " + umechs.map(function (m) { return "<a data-m='" + esc(m) + "'>" + esc(m) + "</a>"; }).join(", ") + "</p>" : "") +
      "<p class='note'>DFT results appear here after the calculations, once the website is rebuilt.</p>";
    $(".pane[data-p=i] .info", body).addEventListener("click", function (e) { if (e.target.dataset.m) { setTab("mech"); showMech(e.target.dataset.m); } });

    var pv = null;
    function showPath() {
      if (pv) return;
      if (st.path === false) { pv = true; $(".pane[data-p=p]", body).innerHTML = "<div class='info'>No TS guess or path for this step yet (make_paths.py, then rebuild the website).</div>"; return; }
      load("path", ch, sid).then(function (P) {
        var pane = $(".pane[data-p=p]", body), fr = frames(P.xyz), n = fr.length, v = viewer3d($(".v3d", pane));
        pv = v;
        v.addModelsAsFrames(P.xyz, "xyz"); styleAll(v, "ball"); v.zoomTo();
        /* position k on the slider shows frame at(k): backwards, from the step's right side to its left side */
        var at = function (k) { return rev ? n - 1 - k : k; }, tsFrame = typeof P.ts === "number" ? P.ts : 0;
        var slider = $("input[type=range]", pane), lab = $(".fr", pane), k = at(tsFrame), timer = null, labels = false;
        var ka = keyAtoms((xyzOf(st.start, ch) || "").split(/\r?\n/)[1]), d = Array.isArray(P.d) ? P.d : [];
        slider.max = n - 1;
        $("a[download]", pane).href = "xyz/ts_guesses/Ch_" + ch + "/" + sid + "_path.xyz";
        function draw() {
          var j = at(k), f = fr[j];
          Promise.resolve(v.setFrame(j)).then(function () {
            v.removeAllShapes(); v.removeAllLabels();
            (P.changed || []).forEach(function (pr) {
              var a = f.atoms[pr[0]], b = f.atoms[pr[1]];
              if (a && b) v.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, radius: 0.08, color: st.colour, dashed: true, fromCap: 1, toCap: 1 });
            });
            if (labels) Object.keys(ka).forEach(function (i) { var a = f.atoms[+i]; if (a) v.addLabel(ka[i], { position: { x: a.x, y: a.y, z: a.z }, fontSize: 11, fontColor: "black", backgroundColor: "white", backgroundOpacity: 0.75, inFront: true }); });
            v.render();
          });
          slider.value = k;
          lab.textContent = "image " + k + "/" + (n - 1) + (j === tsFrame ? "  (TS guess)" : "") + (typeof d[j] === "number" ? "  d = " + d[j].toFixed(2) + " Å" : "");
        }
        draw();
        slider.oninput = function () { k = +slider.value; draw(); };
        $(".tools", pane).addEventListener("click", function (e) {
          var a = e.target.dataset.a;
          if (a === "ts") { k = at(tsFrame); draw(); }
          if (a === "labels") { labels = !labels; draw(); }
          if (a === "play") {
            if (timer) { clearInterval(timer); timer = null; e.target.innerHTML = "&#9654; Play"; return; }
            e.target.innerHTML = "&#10073;&#10073; Pause";
            timer = setInterval(function () { k = (k + 1) % n; draw(); }, Math.max(60, Math.round(4000 / n)));
          }
        });
      }).catch(function () { $(".pane[data-p=p]", body).innerHTML = "<div class='info'>No path for this step.</div>"; });
    }
    function showDFT() {
      load("dft", ch, sid).then(function (D) {
        var pane = $(".pane[data-p=q]", body), v = viewer3d($(".v3d", pane)), txt = D.irc || D.ts;
        v.addModelsAsFrames(txt, "xyz"); styleAll(v, "ball"); v.zoomTo(); v.render();
        var fr = frames(txt), slider = $("input[type=range]", pane);
        slider.max = fr.length - 1;
        slider.oninput = function () { Promise.resolve(v.setFrame(+slider.value)).then(function () { v.render(); }); $(".fr", pane).textContent = (D.irc ? "IRC image " : "TS ") + slider.value; };
      }).catch(function () { $(".pane[data-p=q]", body).textContent = "No DFT structure for this step."; });
    }
  }
  function openUserStep(id) {
    var st = userStep(id);
    if (!st) return;
    var body = makeWin(id, st.name + "  (added by @" + st.by + ")", 640);
    body.appendChild(statusWidget(id, S.ch, "step"));
    var used = usersOf(id);
    body.appendChild(h("div", { class: "info ucard" }, [
      h("p", null, [h("b", null, ["Step: "])].concat(stateLinks(st.from), [" → "], stateLinks(st.to))),
      h("p", null, [h("b", null, ["What happens: "]), st.name]),
      st.desc ? h("p", null, [st.desc]) : null,
      h("p", null, ["Added by @" + st.by + (st.at ? " on " + day(st.at) : "") + " for the " + chList(st.ch) + "."]),
      h("p", null, [h("b", null, ["Used by: "]), used.length ? used.join(", ") : "no mechanism yet"]),
      h("p", { class: "note" }, ["A step added by a collaborator: there is no drawing, TS guess or calculation for it yet."]),
      deleteButton("steps", id)
    ]));
  }

  // ------------------------------------------------------------------ right-click menus (steps, mechanisms, network boxes)
  var ctx = null;
  function closeMenu() { if (ctx) { ctx.remove(); ctx = null; } }
  /* items: {label, act, disabled} | {label, check, act(on)} (a tick box) | "-" */
  function openMenu(x, y, title, items) {
    closeMenu();
    var m = h("div", { class: "ctxmenu", role: "menu", "aria-label": title }, [h("div", { class: "ctxtitle" }, [title])]);
    items.forEach(function (it) {
      if (it === "-") { m.appendChild(h("div", { class: "ctxsep", role: "separator" })); return; }
      if (it.check !== undefined) {
        var cb = h("input", { type: "checkbox", checked: !!it.check, tabindex: "-1" });
        var row = h("button", { class: "ctxitem ctxcheck", role: "menuitemcheckbox", "aria-checked": it.check ? "true" : "false" }, [cb, " " + it.label]);
        row.addEventListener("click", function (e) {
          e.preventDefault();
          it.check = !it.check; cb.checked = it.check; row.setAttribute("aria-checked", it.check ? "true" : "false");
          it.act(it.check);
        });
        m.appendChild(row);
        return;
      }
      var b = h("button", { class: "ctxitem", role: "menuitem", disabled: !!it.disabled }, [it.label]);
      if (!it.disabled) b.addEventListener("click", function () { closeMenu(); it.act(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + "px";
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + "px";
    ctx = m;
    var first = $(".ctxitem:not([disabled])", m);
    if (first) first.focus();
  }
  /* a press outside the menu closes it, and that press does nothing else (its click is swallowed, as with the
     browser's own menus); dragging still works */
  var swallow = false;
  document.addEventListener("mousedown", function (e) {
    swallow = !!ctx && !ctx.contains(e.target);
    if (swallow) closeMenu();
  }, true);
  document.addEventListener("click", function (e) { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener("mouseup", function () { if (swallow) setTimeout(function () { swallow = false; }, 0); }, true);   // only that click
  document.addEventListener("keydown", function (e) {
    if (!ctx) return;
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      var its = $$(".ctxitem:not([disabled])", ctx), i = its.indexOf(document.activeElement);
      if (its.length) its[(i + (e.key === "ArrowDown" ? 1 : its.length - 1)) % its.length].focus();
      e.preventDefault();
    }
  });
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
  document.addEventListener("scroll", closeMenu, true);
  function noEditLine() {           // what someone who cannot mark or edit sees in a menu
    return { disabled: true, label: !Annot.loaded ? "marks unavailable" : Annot.user && !Annot.hasPush ? "read only: no push access" : "sign in to mark or edit" };
  }
  function markItems(id, ch) {      // possible / not possible / clear / urea and thiourea / remove or restore
    var keys = function () { return (S.both ? ["O", "S"] : [ch]).filter(function (c) { return exists(id, c); }).map(function (c) { return key(c, id); }); };
    var mine = ownStatus(id, ch), rm = Annot.removed(key(ch, id));
    return [
      { label: "✓ mark possible", act: function () { Annot.setStatus(keys(), "yes", ""); } },
      { label: "✗ mark not possible", act: function () { Annot.setStatus(keys(), "no", ""); } },
      { label: "clear the mark", disabled: !mine, act: function () { Annot.setStatus(keys().filter(function (k) { return Annot.statusOf(k); }), null, ""); } },
      { label: "urea and thiourea", check: S.both, act: function (on) { S.both = on; savePrefs(); $$(".vboth input").forEach(function (x) { x.checked = on; }); } },
      "-",
      rm ? { label: "restore to network", act: function () { Annot.restore(keys().filter(function (k) { return Annot.removed(k); })); } }
         : { label: "remove from network", act: function () { Annot.remove(keys(), ""); } }
    ];
  }
  function titleOf(id, ch, kind) { var st = kind === "mech" ? mechStatus(id, ch) : stepStatus(id, ch); return id + " · " + statusText(st); }
  function stepMenu(e, sid, dir, ch) {
    if (!isStep(sid, ch)) return false;
    var back = dir === "rev" && !userStep(sid) && !!(baseStep(sid, ch) || {}).rev;
    openMenu(e.clientX, e.clientY, titleOf(sid, ch, "step"), [{ label: "open " + sid + (back ? " (backwards)" : ""), act: function () { openStep(sid, back ? "rev" : "fwd"); } }]
      .concat(Annot.canEdit ? markItems(sid, ch) : [noEditLine()]));
    return true;
  }
  function mechMenu(e, mid, ch) {
    if (!isMech(mid, ch)) return false;
    openMenu(e.clientX, e.clientY, titleOf(mid, ch, "mech"), [{ label: "open " + mid, act: function () { setTab("mech"); showMech(mid); } }]
      .concat(Annot.canEdit ? markItems(mid, ch) : [noEditLine()]));
    return true;
  }
  function stateMenu(e, g) {
    var m = /(?:^|\s)k-([nu]\d+)(?:\s|$)/.exec(g.getAttribute("class") || ""), node = null;
    if (m && net.G) net.G.nodes.forEach(function (n) { if (n.name === m[1]) node = n; });
    if (!node) return false;
    var ch = S.ch;
    openMenu(e.clientX, e.clientY, node.key, [{ label: "open " + node.key, act: function () { openMol(node.sp.slice()); } }]
      .concat(Annot.canEdit ? [{ label: "add a step from " + node.key + "…", act: function () { addStepWin(ch, null, null, node.key); } }] : [noEditLine()]));
    return true;
  }
  document.addEventListener("contextmenu", function (e) {
    var t = e.target, done = false;
    if (!t || !t.closest || t.closest("input, textarea, select")) return;      // text fields keep the browser's menu (paste …)
    if (t.closest(".ctxmenu")) { e.preventDefault(); return; }
    var g = t.closest("#netview g.edge, #netview g.node"), lk = t.closest("#mechview .lk, #mechview .steplink");
    var mb = t.closest("#famlist button[data-m], #famlist .fam.umech[data-m]");
    if (g && (g.id || "").indexOf("st|") === 0) { var q = g.id.split("|"); done = stepMenu(e, q[1], q[2], S.ch); }
    else if (g && (g.id || "").indexOf("sp|") === 0) done = stateMenu(e, g);
    else if (lk) done = stepMenu(e, lk.getAttribute("data-step"), lk.getAttribute("data-dir"), S.ch);
    else if (mb) done = mechMenu(e, mb.getAttribute("data-m"), S.ch);
    else if (t.closest("#mechtitle, #mechbar") && S.mech) done = mechMenu(e, S.mech, S.ch);
    if (done) e.preventDefault();
  });

  // ------------------------------------------------------------------ mechanisms tab
  function query() {
    var words = ($("#q").value || "").trim().toLowerCase().split(/\s+/), is = null, rest = [];
    words.forEach(function (w) { var m = /^is:([a-z]+)$/.exec(w); if (m) is = m[1]; else if (w) rest.push(w); });
    return { text: rest.join(" "), is: is };
  }
  function isMatch(is, ch, id) {
    if (!is) return true;
    switch (is) {
      case "possible": return shownStatus(id, ch).state === "yes";
      case "notpossible": case "impossible": return shownStatus(id, ch).state === "no";
      case "conflict": return shownStatus(id, ch).state === "conflict";
      case "unmarked": return shownStatus(id, ch).state === "none";
      case "marked": return shownStatus(id, ch).state !== "none";
      case "removed": return !!Annot.removed(key(ch, id));
      case "added": case "user": return Annot.isUser(id);
      default: return true;
    }
  }
  function groupOrder() {
    var order = Object.keys(window.NETWORK_GROUPS || {});
    Object.keys(META.families).forEach(function (f) { var g = META.families[f].group; if (g && order.indexOf(g) < 0) order.push(g); });
    return order;
  }
  function famList() {
    var q = query(), F = META.families, groups = {}, mm = M().mechanisms, byFam = {};
    Object.keys(mm).forEach(function (mid) { var f = mm[mid].family || mid; (byFam[f] = byFam[f] || []).push(mid); });
    Object.keys(byFam).sort(nat).forEach(function (f) {
      var info = F[f] || { group: "other mechanisms", text: mm[byFam[f][0]].name }, t = chText(info.text || ""), g = info.group || "other mechanisms";
      var ms = byFam[f].sort(nat).filter(function (mid) { return isMatch(q.is, S.ch, mid); });
      if (!ms.length) return;
      if (q.text && (f + " " + t + " " + g).toLowerCase().indexOf(q.text) < 0 && !ms.some(function (mid) {
        return mid.toLowerCase() === q.text || mm[mid].steps.some(function (s) { return s.toLowerCase() === q.text; });
      })) return;
      (groups[g] = groups[g] || []).push([f, t, ms]);
    });
    var hh = "", order = groupOrder().concat(["other mechanisms"]);
    order.forEach(function (g) {
      if (!groups[g]) return;
      hh += "<div class='group'><h3>" + esc(chText(g)) + "</h3>";
      groups[g].forEach(function (x) {
        var on = x[2].indexOf(S.mech) >= 0;
        hh += "<div class='fam" + (on ? " on" : "") + "' data-first='" + esc(x[2][0]) + "'><span class='id'>" + esc(x[0]) + "</span><span class='txt'>" + esc(x[1]) +
          "</span><div class='ab'>" + x[2].map(function (mid) {
            var suffix = mid.indexOf(x[0]) === 0 && mid.length > x[0].length ? mid.slice(x[0].length) : mid;
            return "<button data-m='" + esc(mid) + "' class='" + (S.mech === mid ? "on" : "") + (Annot.removed(key(S.ch, mid)) ? " rmd" : "") + "'>" +
              esc(suffix) + " &rarr; " + esc(mm[mid].product || "") + badge(mid, S.ch) + "</button>";
          }).join("") + "</div></div>";
      });
      hh += "</div>";
    });
    var U = doc().mechanisms, um = Object.keys(U).sort(nat).filter(function (mid) {
      var m = U[mid];
      return m.ch.indexOf(S.ch) >= 0 && isMatch(q.is, S.ch, mid) && (!q.text || (mid + " " + m.name + " " + m.desc + " " + m.by + " " +
        m.hops.map(function (x) { return x.step || ""; }).join(" ")).toLowerCase().indexOf(q.text) >= 0);
    });
    if (um.length) {
      hh += "<div class='group'><h3>Added by collaborators</h3>";
      um.forEach(function (mid) {
        var m = U[mid];
        hh += "<div class='fam umech" + (S.mech === mid ? " on" : "") + (Annot.removed(key(S.ch, mid)) ? " rmd" : "") + "' data-m='" + esc(mid) + "'><span class='id'>" + esc(mid) +
          "</span><span class='txt'>" + esc(m.name) + "</span> " + badge(mid, S.ch) +
          "<div class='by'>added by @" + esc(m.by) + " &middot; ends at " + esc(m.product) + "</div></div>";
      });
      hh += "</div>";
    }
    $("#famlist").innerHTML = hh || "<div class='hint'>Nothing matches.</div>";
  }
  function firstMech() { return Object.keys(M().mechanisms).sort(nat)[0] || null; }
  function mechBar(mid) {
    var bar = $("#mechbar");
    bar.textContent = "";
    bar.hidden = !mid;
    if (!mid) return;
    bar.appendChild(statusWidget(mid, S.ch, "mech"));
    var del = userMech(mid) ? deleteButton("mechanisms", mid) : null;
    if (del) bar.appendChild(del);
  }
  function showMech(mid) {
    if (userMech(mid)) { showUserMech(mid); return; }
    var mm = baseMech(mid), ch = S.ch;
    S.mech = mm ? mid : null; famList();
    $("#mechtitle").textContent = mm ? mid + ": " + chText(mm.name) + "  (" + CHN[ch] + ")" : "";
    mechBar(mm ? mid : null);
    if (!mm) { $("#mechview").innerHTML = "<div class='hint'>Pick a mechanism on the left.</div>"; return; }
    if (mm.drawn === false) { $("#mechview").innerHTML = "<div class='hint'>No drawing of this mechanism yet: rebuild the website (make_website.py) to draw it.</div>"; return; }
    $("#mechview").innerHTML = "<div class='hint'>loading&hellip;</div>";
    load("mech", ch, mid).then(function (svg) {
      if (S.mech !== mid || S.ch !== ch) return;
      $("#mechview").innerHTML = svg; zoom(S.zoom || "fit");
    }, function () {
      if (S.mech !== mid || S.ch !== ch) return;
      $("#mechview").innerHTML = "<div class='hint'>No drawing of this mechanism yet: rebuild the website (make_website.py) to draw it.</div>";
    });
  }
  function stepSVG(box, sid, dir) {   // a built-in step's drawing (the other direction when this one was not drawn)
    var st = baseStep(sid), d = dir === "rev" && st && st.rev ? "rev" : "fwd";
    if (!st || st.drawn === false) { box.textContent = NODRAW; return; }
    load("step", S.ch, sid + "_" + d).then(function (svg) {
      box.innerHTML = svg;
      box.classList.toggle("show3d", S.ts3d && !!box.querySelector(".ts3d"));
      if (d !== dir) box.insertBefore(h("div", { class: "note" }, ["Drawn forwards; this mechanism uses the step backwards."]), box.firstChild);
    }, function () { box.textContent = "No drawing for this step."; });
  }
  function showUserMech(mid) {
    S.mech = mid; famList();
    var m = userMech(mid), view = $("#mechview");
    S.umech = JSON.stringify(m);
    $("#mechtitle").textContent = mid + ": " + m.name + "  (" + CHN[S.ch] + ")";
    mechBar(mid);
    view.textContent = "";
    var page = h("div", { class: "upage" }, [
      h("p", { class: "note" }, ["Added by @" + m.by + (m.at ? " on " + day(m.at) : "") + " for the " + chList(m.ch) +
        (m.ch.indexOf(S.ch) < 0 ? " (not for the " + CHN[S.ch] + ")" : "") + ". Its steps in order; click a step for its window."]),
      m.desc ? h("p", null, [m.desc]) : null
    ]);
    m.hops.forEach(function (hp, k) {
      var card = h("div", { class: "hop" + (hp.step && userStep(hp.step) ? " usr" : "") });
      var head = h("div", { class: "hophead" }, [(k + 1) + ". "].concat(stateLinks(hp.from), [" → "], stateLinks(hp.to), ["  "]));
      card.appendChild(head);
      if (!hp.step) {
        head.appendChild(h("span", { class: "note" }, ["proton transfer (no TS)"]));
      } else if (userStep(hp.step)) {
        var us = userStep(hp.step);
        head.appendChild(h("a", { class: "steplink", "data-step": hp.step, "data-dir": hp.dir }, [hp.step + (hp.dir === "rev" ? " (backwards)" : "")]));
        card.appendChild(h("div", { class: "ucard" }, [h("b", null, [us.name]), us.desc ? h("p", null, [us.desc]) : null,
          h("p", { class: "note" }, ["Step added by @" + us.by + "; no drawing yet."])]));
      } else if (baseStep(hp.step)) {
        head.appendChild(h("a", { class: "steplink", "data-step": hp.step, "data-dir": hp.dir }, [hp.step + (hp.dir === "rev" ? " (backwards)" : "") + ": " +
          chText(baseStep(hp.step).name)]));
        var box = h("div", { class: "svgbox" }, ["loading…"]);
        card.appendChild(box);
        stepSVG(box, hp.step, hp.dir);
      } else {
        head.appendChild(h("span", { class: "note" }, [hp.step + " is not a step of the " + CHN[S.ch] + " project"]));
      }
      page.appendChild(card);
    });
    view.appendChild(page);
  }
  function zoom(z) {
    if (userMech(S.mech)) return;
    var svg = $("#mechview svg"); if (!svg) return;
    var w0 = +svg.getAttribute("width") || svg.viewBox.baseVal.width, h0 = +svg.getAttribute("height") || svg.viewBox.baseVal.height;
    if (!svg.dataset.w) { svg.dataset.w = w0; svg.dataset.h = h0; }
    var W = +svg.dataset.w, H = +svg.dataset.h, cur = svg.getBoundingClientRect().width / W, f;
    var cw = $("#mechview").clientWidth;
    if (z === "fit" && cw < 50) { setTimeout(function () { zoom("fit"); }, 60); return; }
    if (z === "fit") f = (cw - 4) / W;
    else if (z === "+") f = cur * 1.25; else if (z === "-") f = cur / 1.25; else f = +z;
    svg.setAttribute("width", W * f); svg.setAttribute("height", H * f); S.zoom = z === "+" || z === "-" ? f : z;
  }
  $("#famlist").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-m]"); if (b) { showMech(b.getAttribute("data-m")); return; }
    var u = e.target.closest(".fam[data-m]"); if (u) { showMech(u.getAttribute("data-m")); return; }
    var f = e.target.closest(".fam[data-first]"); if (f) showMech(f.getAttribute("data-first"));
  });
  $("#mechview").addEventListener("click", function (e) {
    var sl = e.target.closest(".steplink"); if (sl) { openStep(sl.getAttribute("data-step"), sl.getAttribute("data-dir")); return; }
    var lk = e.target.closest(".lk"); if (lk) { openStep(lk.dataset.step, lk.dataset.dir); return; }
    var sp = e.target.closest(".sp"); if (sp) openMol(sp.dataset.ids.split(" "));
  });
  $$(".zoombar button[data-z]").forEach(function (b) { b.onclick = function () { zoom(b.dataset.z); }; });

  // ------------------------------------------------------------------ network tab (pan / zoom, filter, layout of edited networks)
  var net = { vb: null, el: null, full: null, kind: null, src: null, want: null, wired: false, G: null };
  function wireNet() {
    if (net.wired) return;
    net.wired = true;
    var box = $("#netview"), drag = null;
    /* menu: this press closes a right-click menu (so it opens nothing); a menu still open at the release was opened
       by this press (ctrl-click on a Mac) */
    box.addEventListener("pointerdown", function (e) { if (net.el && e.button === 0) drag = { x: e.clientX, y: e.clientY, vb: net.vb.slice(), moved: false, menu: !!ctx }; });
    box.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var r = box.getBoundingClientRect(), s = net.vb[2] / r.width;
      var dx = (e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      net.vb[0] = drag.vb[0] - dx; net.vb[1] = drag.vb[1] - dy; setVB();
    });
    box.addEventListener("pointerup", function (e) {
      var d = drag; drag = null;
      if (e.button !== 0 || !d || d.moved || d.menu || ctx) return;          // a drag, the right button (its menu), or a menu
      var g = e.target.closest("g.node, g.edge"); if (!g) return;
      var id = g.id || "";
      if (id.indexOf("sp|") === 0) openMol(id.slice(3).split(" "));
      if (id.indexOf("st|") === 0) { var q = id.split("|"); openStep(q[1], q[2]); }
    });
    box.addEventListener("wheel", function (e) {
      closeMenu();
      if (!net.el) return;
      e.preventDefault();
      var r = box.getBoundingClientRect(), f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      var mx = net.vb[0] + (e.clientX - r.left) / r.width * net.vb[2], my = net.vb[1] + (e.clientY - r.top) / r.height * net.vb[3];
      net.vb[2] *= f; net.vb[3] *= f; net.vb[0] = mx - (e.clientX - r.left) / r.width * net.vb[2]; net.vb[1] = my - (e.clientY - r.top) / r.height * net.vb[3];
      setVB();
    }, { passive: false });
  }
  function netLegend() {          // the legend of the chalcogen shown
    var NG = window.NETWORK_GRAPH[S.ch], ptStep = NG.edges.some(function (e) { return e.pt && e.step; }), ptLine = NG.edges.some(function (e) { return !e.step; });
    var lg = "<b>Arrow colour: where the redox happens</b>";
    Object.keys(NETWORK_GROUPS).forEach(function (g) { lg += "<div><i style='background:" + esc(NETWORK_GROUPS[g]) + "'></i>" + esc(chText(g)) + "</div>"; });
    if (ptStep) lg += "<div><i style='background:" + esc(NG.pt_step_colour) + "'></i>proton transfer through the acid catalyst (HA / A⁻)</div>";
    if (ptLine) lg += "<div><i class='dash' style='border-color:" + esc(NG.pt_colour) + "'></i>proton transfer (no step)</div>";
    lg += "<div><i class='dash' style='border-color:" + NetGraph.USER_COL + "'></i>added by a collaborator</div>" +
      "<div><i style='background:#9aa3ad;opacity:0.5'></i>greyed: removed, or not possible (with “grey out”)</div>";
    $("#netlegend").innerHTML = lg;
  }
  function setNetSVG(svg) {
    var box = $("#netview");
    box.textContent = "";
    box.appendChild(svg);
    svg.removeAttribute("width"); svg.removeAttribute("height"); svg.style.width = "100%"; svg.style.height = "100%";
    net.el = svg;
    var b = svg.viewBox.baseVal;
    net.full = { x: b.x, y: b.y, width: b.width, height: b.height };
    netFit();
  }
  function setVB() { net.el.setAttribute("viewBox", net.vb.join(" ")); }
  function netFit() {
    if (!net.el) return;
    var box = $("#netview").getBoundingClientRect(), f = net.full, ar = box.width / Math.max(box.height, 1);
    if (box.width < 2 || box.height < 2) { net.needFit = true; return; }   // the tab is hidden: fit when it is shown
    net.needFit = false;
    var w = f.width, hh = f.height;
    if (w / hh > ar) hh = w / ar; else w = hh * ar;
    net.vb = [f.x - (w - f.width) / 2, f.y - (hh - f.height) / 2, w, hh]; setVB();
  }
  function netFind(q) {
    if (!net.el || S.tab !== "net") return;
    $$("g.hl", net.el).forEach(function (g) { g.classList.remove("hl"); });
    if (!q) return;
    var hit = $$("g.node", net.el).filter(function (g) { return (" " + g.id.slice(3) + " ").toLowerCase().indexOf(" " + q + " ") >= 0; });
    hit.forEach(function (g) { g.classList.add("hl"); });
    if (hit.length) {
      var b = rootBox(hit[0]), w = Math.max(b.width * 8, 1400), box = $("#netview").getBoundingClientRect();
      net.vb = [b.x + b.width / 2 - w / 2, b.y + b.height / 2 - w * box.height / box.width / 2, w, w * box.height / box.width]; setVB();
    }
  }
  function rootBox(el) {          // the box of an element in the coordinates of the viewBox (Graphviz shifts its graph with a transform)
    var b = el.getBBox(), m = net.el.createSVGMatrix();
    for (var p = el; p && p !== net.el; p = p.parentNode) {
      var t = p.transform && p.transform.baseVal.consolidate();
      if (t) m = t.matrix.multiply(m);
    }
    var a = net.el.createSVGPoint(), c = net.el.createSVGPoint();
    a.x = b.x; a.y = b.y; c.x = b.x + b.width; c.y = b.y + b.height;
    a = a.matrixTransform(m); c = c.matrixTransform(m);
    return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y) };
  }
  function netOpts(mode, showRemoved) {
    var ch = S.ch;
    return { mode: mode, showRemoved: showRemoved, removed: function (id) { return !!Annot.removed(key(ch, id)); },
             stepStatus: function (id) { return stepStatus(id, ch).state; }, mechStatus: function (id) { return mechStatus(id, ch).state; } };
  }
  function busy(on) { $("#netbusy").hidden = !on; }
  function markGrey(grey, np) {    // greyed boxes and arrows in the pre-rendered network: removed (rm), not possible (np)
    $$("g.node, g.edge", net.el).forEach(function (g) {
      var m = /(?:^|\s)k-(n|e)(\d+)(?:\s|$)/.exec(g.getAttribute("class") || ""), kind = m && (m[1] === "n" ? "node" : "edge");
      g.classList.toggle("rm", !!(m && grey && grey[kind][+m[2]]));
      g.classList.toggle("np", !!(m && np && np[kind][+m[2]]));
    });
  }
  function minus(a, b) { return { node: a.node.map(function (v, i) { return v && !b.node[i]; }), edge: a.edge.map(function (v, i) { return v && !b.edge[i]; }) }; }
  function renderNet() {
    if (S.tab !== "net") return;
    wireNet();
    if (net.ch !== S.ch) { net.ch = S.ch; net.kind = null; net.src = null; net.want = null; netLegend(); }   // the other chalcogen's network
    var mode = S.netMode === "hide" ? "hide" : "all", G = NetGraph.model(S.ch, doc(), M());
    var base = NetGraph.visible(G, netOpts(mode, false)), vis = base, grey = null, np = null;
    if (S.netRemoved) { vis = NetGraph.visible(G, netOpts(mode, true)); grey = minus(vis, base); }
    if (S.netMode === "grey") np = minus(base, NetGraph.visible(G, netOpts("hide", false)));    // what "hide" would leave out
    net.G = G;
    var count = function (a, n0, n1) { var c = 0; for (var i = n0; i < n1; i++) if (a[i]) c++; return c; };
    var nu = count(vis.node, G.nBase, G.nodes.length) + count(vis.edge, G.eBase, G.edges.length);
    var ng = grey ? count(grey.node, 0, G.nodes.length) + count(grey.edge, 0, G.edges.length) : 0;
    var nn = np ? count(np.node, 0, G.nodes.length) + count(np.edge, 0, G.edges.length) : 0;
    $("#netinfo").textContent = count(vis.node, 0, G.nBase) + " of " + G.nBase + " states and " + count(vis.edge, 0, G.eBase) + " of " + G.eBase + " arrows" +
      (nu ? ", " + nu + " added" : "") + (ng ? ", " + ng + " removed (grey)" : "") + (nn ? ", " + nn + " not possible (grey)" : "") +
      (S.netMode !== "all" ? " · statuses for the " + CHN[S.ch] + " (" + S.ch + ")" : "");
    if (!vis.node.some(Boolean)) {   // nothing left: say why instead of an empty picture
      net.want = "empty"; net.kind = "empty"; net.src = null; net.el = null;
      busy(false);
      var box = $("#netview");
      box.textContent = "";
      box.appendChild(h("div", { class: "hint" }, ["No route from the reactants to a product is left with this filter."]));
      return;
    }
    if (NetGraph.isFull(G, vis)) {
      net.want = "pre";
      if (net.kind !== "pre") {
        var t = document.createElement("div");
        t.innerHTML = NETWORK_SVG[S.ch];
        setNetSVG(t.querySelector("svg"));
        net.kind = "pre"; net.src = null;
      }
      markGrey(grey, np);
      busy(false);
      if (net.needFit) netFit();
      afterNet();
      return;
    }
    var src = NetGraph.dot(G, vis, grey, np);
    net.want = src;
    if (net.kind === "viz" && net.src === src) { busy(false); if (net.needFit) { netFit(); afterNet(); } return; }
    busy(true);
    setTimeout(function () {         // lets "laying out…" show first
      if (net.want !== src) return;
      NetGraph.render(G, vis, src).then(function (svg) {
        if (net.want !== src) return;
        setNetSVG(svg);
        net.kind = "viz"; net.src = src;
        busy(false);
        afterNet();
      }, function (err) {
        busy(false);
        $("#netinfo").textContent = "Could not lay out the network: " + err.message;
      });
    }, 30);
  }
  function afterNet() {
    netFind(query().text);
    if (S.builder) S.builder.highlight();
  }
  var netTimer = null;
  function renderNetSoon() { clearTimeout(netTimer); netTimer = setTimeout(renderNet, 150); }
  $$(".zoombar button[data-nz]").forEach(function (b) {
    b.onclick = function () {
      if (!net.el) return;
      if (b.dataset.nz === "fit") { netFit(); return; }
      var f = b.dataset.nz === "+" ? 1 / 1.3 : 1.3, cx = net.vb[0] + net.vb[2] / 2, cy = net.vb[1] + net.vb[3] / 2;
      net.vb[2] *= f; net.vb[3] *= f; net.vb[0] = cx - net.vb[2] / 2; net.vb[1] = cy - net.vb[3] / 2; setVB();
    };
  });
  $("#netmode").addEventListener("change", function () { S.netMode = $("#netmode").value; savePrefs(); renderNet(); });
  $("#netremoved").addEventListener("change", function () { S.netRemoved = $("#netremoved").checked; savePrefs(); renderNet(); });
  $("#addstep").addEventListener("click", function () { addStepWin(S.ch, null, null); });
  $("#addmech").addEventListener("click", function () { builderWin(); });

  // ------------------------------------------------------------------ adding a step (and maybe a new species)
  function normState(t) {
    return String(t || "").split("+").map(function (s) { return s.trim().replace(/\s+/g, " "); }).filter(Boolean).join(" + ");
  }
  function knownIn(id, chs) {
    return chs.every(function (c) { var u = userSpecies(id); return u ? u.ch.indexOf(c) >= 0 : !!baseSpecies(id, c); });
  }
  function addStepWin(ch, fixedFrom, done, fromState) {
    if (!Annot.canEdit) return;
    var G = NetGraph.model(ch, doc(), META.ch[ch]), listId = "states" + (++S.top), opts = {};
    G.nodes.forEach(function (n) { opts[n.key] = 1; });
    Object.keys(META.ch[ch].species).concat(Object.keys(doc().species)).forEach(function (s) { opts[s] = 1; });
    var dl = h("datalist", { id: listId }, Object.keys(opts).sort(nat).map(function (k) { return h("option", { value: k }); }));
    var body = makeWin("Add a step", "between two states, for the urea and/or the thiourea", 600);
    function side(label, fixed, prefill) {
      var fs = h("fieldset", { class: "side" }, [h("legend", null, [label])]);
      if (fixed) { fs.appendChild(h("div", null, [h("b", null, [fixed]), h("span", { class: "note" }, ["  (where the new mechanism has got to)"])])); return { el: fs, get: function () { return { state: fixed }; } }; }
      var name = "r" + (++S.top), r1 = h("input", { type: "radio", name: name, checked: true }), r2 = h("input", { type: "radio", name: name });
      var inp = h("input", { type: "text", list: listId, placeholder: "I5a, I2 + I132a, P1a …", "aria-label": label + " state" });
      if (prefill) inp.value = prefill;
      var nm = h("input", { type: "text", maxlength: "120", placeholder: "name", "aria-label": "name of the new species" });
      var sm = h("input", { type: "text", maxlength: "300", placeholder: "SMILES (optional)", "aria-label": "SMILES of the new species", class: "mono" });
      fs.appendChild(h("label", { class: "chk" }, [r1, " a species or state already in the network: ", inp]));
      fs.appendChild(h("label", { class: "chk" }, [r2, " a new species: ", nm, sm]));
      inp.addEventListener("focus", function () { r1.checked = true; });
      nm.addEventListener("focus", function () { r2.checked = true; });
      sm.addEventListener("focus", function () { r2.checked = true; });
      return { el: fs, get: function () { return r2.checked ? { name: nm.value.trim(), smiles: sm.value.trim() } : { state: normState(inp.value) }; } };
    }
    var a = side("From", fixedFrom, fromState), b = side("To"), name = h("input", { type: "text", maxlength: "120", placeholder: "e.g. 1,2-hydride shift C4 → C5" });
    var desc = h("textarea", { rows: "3", maxlength: "1000", placeholder: "what happens: bonds made and broken, where the proton goes …" });
    var cO = h("input", { type: "checkbox", checked: ch === "O" || S.both }), cS = h("input", { type: "checkbox", checked: ch === "S" || S.both });
    var err = h("p", { class: "err", role: "alert" });
    function check(x, chs) {
      if (x.state !== undefined) {
        var p = NetGraph.parseState(x.state);
        if (!p) return "Write a state as species IDs joined by +, e.g. I2 + I132a.";
        var bad = p.ids.filter(function (s) { return !knownIn(s, chs); });
        return bad.length ? bad.join(", ") + " is not a species of the " + chs.map(function (c) { return CHN[c]; }).join(" and the ") + "." : "";
      }
      if (!x.name) return "Give the new species a name.";
      if (x.smiles && !Annot.cleanSmiles(x.smiles)) return "The SMILES may only use letters, digits and @+-[]()\\/%=#$:.*~";
      return "";
    }
    var ok = h("button", { class: "btn primary", onclick: function () {
      var chs = (cO.checked ? ["O"] : []).concat(cS.checked ? ["S"] : []), A1 = a.get(), B1 = b.get();
      var problem = !chs.length ? "Tick the urea, the thiourea or both." : check(A1, chs) || check(B1, chs) ||
        (!name.value.trim() ? "Give the step a name (what happens, in a few words)." : !desc.value.trim() ? "Describe the step." : "");
      if (!problem && A1.state && B1.state && NetGraph.canon(NetGraph.parseState(A1.state)) === NetGraph.canon(NetGraph.parseState(B1.state)))
        problem = "The two sides are the same state.";
      if (!problem && !Annot.canEdit) problem = "You are no longer signed in as a collaborator.";
      if (problem) { err.textContent = problem; return; }
      var from = A1.state || Annot.add("species", { name: A1.name, smiles: Annot.cleanSmiles(A1.smiles), ch: chs });
      var to = B1.state || Annot.add("species", { name: B1.name, smiles: Annot.cleanSmiles(B1.smiles), ch: chs });
      var id = Annot.add("steps", { from: from, to: to, name: name.value.trim(), desc: desc.value.trim(), ch: chs });
      closeWin(body);
      toast("Added step " + id + ": " + from + " → " + to);
      if (done) done(id, from, to);
    } }, ["Add step"]);
    body.appendChild(h("div", { class: "form" }, [dl, a.el, b.el,
      h("label", { class: "field" }, ["Name ", name]), h("label", { class: "field" }, ["Description ", desc]),
      h("div", { class: "row" }, [h("span", null, ["For: "]), h("label", { class: "chk" }, [cO, " urea (O)"]), h("label", { class: "chk" }, [cS, " thiourea (S)"])]),
      err, h("div", { class: "row" }, [ok, h("button", { class: "btn", onclick: function () { closeWin(body); } }, ["Cancel"])]),
      h("p", { class: "note" }, ["The step is drawn dashed in the network. It needs no mechanism; it can be marked possible or not possible like any other step."])]));
  }

  // ------------------------------------------------------------------ building a mechanism
  function builderWin() {
    if (!Annot.canEdit) return;
    if (S.builder && S.builder.body.isConnected) { S.builder.body.closest(".win").style.zIndex = ++S.top; return; }
    var ch = S.ch, hops = [], body = makeWin("New mechanism (" + CHN[ch] + ")", "start at the reactants and pick steps until a product", 660);
    var form = { name: "", desc: "", O: ch === "O" || S.both, S: ch === "S" || S.both };   // kept when the window is redrawn
    body.classList.add("builder");
    var B = S.builder = { body: body, draw: draw, highlight: highlight };
    function model() { return NetGraph.model(ch, doc(), META.ch[ch]); }
    function current(G) {
      if (!hops.length) return G.nodes.filter(function (n) { return n.kind === "start"; })[0];
      return G.find(hops[hops.length - 1].to) || G.nodeFor(hops[hops.length - 1].to);
    }
    function options(G, cur) {
      var seen = {}, out = [];
      G.edges.forEach(function (e) {
        var fwd = e.from === cur.i, back = e.to === cur.i;
        if ((!fwd && !back) || (e.step && Annot.removed(key(ch, e.step)))) return;
        var target = G.nodes[fwd ? e.to : e.from], dir = e.step ? (fwd ? e.dir || "fwd" : (e.dir === "rev" ? "fwd" : "rev")) : "fwd";
        var k = target.i + ">" + (e.step || "") + ">" + dir;
        if (seen[k] || target === cur) return;
        seen[k] = 1;
        out.push({ back: !fwd, target: target, e: e, hop: { step: e.step, dir: dir, from: cur.key, to: target.key } });
      });
      return out.sort(function (x, y) { return (x.back - y.back) || nat(x.e.step || "~", y.e.step || "~"); });
    }
    function chip(st) { return h("span", { class: "bstate" }, stateLinks(st)); }
    function highlight() {
      if (!net.el) return;
      $$("g.cur", net.el).forEach(function (g) { g.classList.remove("cur"); });
      if (!body.isConnected) return;
      var G = model(), cur = current(G);
      if (cur) $$("g.node", net.el).forEach(function (g) { if ((" " + (g.getAttribute("class") || "") + " ").indexOf(" k-" + cur.name + " ") >= 0) g.classList.add("cur"); });
    }
    function draw() {
      if (!body.isConnected) { if (S.builder === B) S.builder = null; return; }
      var G = model(), cur = current(G), start = G.nodes.filter(function (n) { return n.kind === "start"; })[0];
      body.textContent = "";
      var path = h("div", { class: "bpath" }, [chip(start.key)]);
      hops.forEach(function (hp) {
        path.appendChild(h("span", { class: "barrow" }, [" → " + (hp.step ? hp.step + (hp.dir === "rev" ? " (back)" : "") : "H⁺") + " → "]));
        path.appendChild(chip(hp.to));
      });
      body.appendChild(path);
      body.appendChild(h("div", { class: "row" }, [
        h("button", { class: "btn", disabled: !hops.length, onclick: function () { hops.pop(); draw(); highlight(); } }, ["undo last step"]),
        h("button", { class: "btn", disabled: !hops.length, onclick: function () { hops = []; draw(); highlight(); } }, ["start again"]),
        h("span", { class: "note" }, ["Now at ", h("b", null, [cur ? cur.key : "?"]), cur && cur.kind === "product" ? " (a product)" : ""])
      ]));
      if (!cur) return;
      var list = h("div", { class: "bopts" }), opts = options(G, cur);
      opts.forEach(function (o) {
        var e = o.e, st = e.step ? stepStatus(e.step, ch).state : "none";
        var nm = e.step ? (userStep(e.step) ? userStep(e.step).name : chText((baseStep(e.step, ch) || {}).name || e.name)) : "proton transfer (no TS)";
        list.appendChild(h("button", { class: "bopt" + (e.base ? "" : " usr"), onclick: function () { hops.push(o.hop); draw(); highlight(); } }, [
          h("b", { style: e.base && e.step ? "color:" + e.colour : null }, [e.step ? e.step : "H⁺"]),
          o.back ? h("span", { class: "back" }, [" backwards"]) : null, " → ", h("b", null, [o.target.key]), "  ", h("span", { class: "nm" }, [nm]),
          st !== "none" ? h("span", { class: "bdg st-" + st }, [WORD[st]]) : null,
          e.user ? h("span", { class: "by" }, [" added by @" + e.user.by]) : null
        ]));
      });
      body.appendChild(h("div", { class: "vlabel" }, [opts.length ? "Next step from " + cur.key + ":" : "No step leaves " + cur.key + " yet."]));
      body.appendChild(list);
      body.appendChild(h("button", { class: "btn", onclick: function () {
        addStepWin(ch, cur.key, function (id, from, to) { hops.push({ step: id, dir: "fwd", from: from, to: to }); draw(); highlight(); });
      } }, ["+ a new step from " + cur.key + "…"]));
      if (cur.kind === "product" && hops.length) {
        var name = h("input", { type: "text", maxlength: "120", placeholder: "e.g. imine route with a late phenyl shift" });
        var desc = h("textarea", { rows: "2", maxlength: "1000", placeholder: "optional: why this route is worth a look" });
        var cO = h("input", { type: "checkbox", checked: form.O }), cS = h("input", { type: "checkbox", checked: form.S });
        var err = h("p", { class: "err", role: "alert" });
        name.value = form.name; desc.value = form.desc;
        name.addEventListener("input", function () { form.name = name.value; });
        desc.addEventListener("input", function () { form.desc = desc.value; });
        cO.addEventListener("change", function () { form.O = cO.checked; });
        cS.addEventListener("change", function () { form.S = cS.checked; });
        body.appendChild(h("fieldset", { class: "side finish" }, [h("legend", null, ["Finish at " + cur.key]),
          h("label", { class: "field" }, ["Name ", name]), h("label", { class: "field" }, ["Description ", desc]),
          h("div", { class: "row" }, [h("span", null, ["For: "]), h("label", { class: "chk" }, [cO, " urea (O)"]), h("label", { class: "chk" }, [cS, " thiourea (S)"])]),
          err,
          h("button", { class: "btn primary", onclick: function () {
            var chs = (cO.checked ? ["O"] : []).concat(cS.checked ? ["S"] : []);
            if (!name.value.trim()) { err.textContent = "Give the mechanism a name."; return; }
            if (!chs.length) { err.textContent = "Tick the urea, the thiourea or both."; return; }
            if (!Annot.canEdit) { err.textContent = "You are no longer signed in as a collaborator."; return; }
            var path = [start.key];
            hops.forEach(function (hp) { if (hp.step) path.push(hp.step); path.push(hp.to); });
            var id = Annot.add("mechanisms", { name: name.value.trim(), desc: desc.value.trim(), ch: chs, product: cur.key, hops: hops, path: path });
            closeWin(body);
            S.builder = null;
            highlight();
            if (chs.indexOf(S.ch) < 0) setCh(chs[0]);
            setTab("mech");
            showMech(id);
            toast("Added mechanism " + id + " (saving…)");
          } }, ["Save mechanism"])]));
      }
    }
    draw();
    highlight();
    if (S.tab !== "net") setTab("net");
  }

  // ------------------------------------------------------------------ tables
  function tables() {
    var q = query(), sp = M().species, rows = "";
    Object.keys(sp).forEach(function (s) {
      var t = (s + " " + sp[s].name).toLowerCase();
      if ((q.text && t.indexOf(q.text) < 0) || !isMatch(q.is, S.ch, s)) return;
      rows += "<tr data-s='" + esc(s) + "'><td class='id'>" + esc(s) + "</td><td>" + esc(chText(sp[s].name)) + "</td><td>" + esc(sp[s].formula) + "</td><td>" +
        sp[s].used_by.length + "</td></tr>";
    });
    var US = doc().species;
    Object.keys(US).sort(nat).forEach(function (s) {
      var u = US[s];
      if (u.ch.indexOf(S.ch) < 0 || (q.text && (s + " " + u.name + " " + u.smiles + " " + u.by).toLowerCase().indexOf(q.text) < 0) || !isMatch(q.is, S.ch, s)) return;
      rows += "<tr class='usr' data-s='" + esc(s) + "'><td class='id'>" + esc(s) + "</td><td>" + esc(u.name) + " <span class='by'>added by @" + esc(u.by) +
        "</span></td><td class='mono'>" + esc(u.smiles) + "</td><td>" + usersOf(s).length + "</td></tr>";
    });
    $("#sptable").innerHTML = "<thead><tr><th>ID</th><th>name</th><th>formula</th><th>mechanisms</th></tr></thead><tbody>" + rows + "</tbody>";
    var st = M().steps; rows = "";
    Object.keys(st).forEach(function (s) {
      var t = (s + " " + st[s].name + " " + st[s].reaction).toLowerCase();
      if ((q.text && t.indexOf(q.text) < 0) || !isMatch(q.is, S.ch, s)) return;
      rows += "<tr data-t='" + esc(s) + "'><td class='id' style='color:" + esc(st[s].colour) + "'>" + esc(s) + "</td><td>" + esc(chText(st[s].name)) + "</td><td>" + esc(st[s].reaction) +
        "</td><td>" + st[s].used_by.filter(function (m) { return baseMech(m); }).length + "</td><td>" + badge(s, S.ch) + "</td></tr>";
    });
    var UT = doc().steps;
    Object.keys(UT).sort(nat).forEach(function (s) {
      var u = UT[s];
      if (u.ch.indexOf(S.ch) < 0 || (q.text && (s + " " + u.name + " " + u.desc + " " + u.from + " " + u.to + " " + u.by).toLowerCase().indexOf(q.text) < 0) || !isMatch(q.is, S.ch, s)) return;
      rows += "<tr class='usr' data-t='" + esc(s) + "'><td class='id'>" + esc(s) + "</td><td>" + esc(u.name) + " <span class='by'>added by @" + esc(u.by) + "</span></td><td>" +
        esc(u.from + " -> " + u.to) + "</td><td>" + usersOf(s).length + "</td><td>" + badge(s, S.ch) + "</td></tr>";
    });
    $("#sttable").innerHTML = "<thead><tr><th>ID</th><th>what happens</th><th>reaction</th><th>mechanisms</th><th>status</th></tr></thead><tbody>" + rows + "</tbody>";
  }
  $("#sptable").addEventListener("click", function (e) { var r = e.target.closest("tr[data-s]"); if (r) openMol([r.getAttribute("data-s")]); });
  $("#sttable").addEventListener("click", function (e) { var r = e.target.closest("tr[data-t]"); if (r) openStep(r.getAttribute("data-t"), "fwd"); });

  // ------------------------------------------------------------------ annotations tab: everything the collaborators did
  function openItem(id, ch) {
    if (ch && ch !== S.ch && (ch === "O" || ch === "S")) setCh(ch);
    if (baseMech(id) || userMech(id)) { setTab("mech"); showMech(id); } else if (baseStep(id) || userStep(id)) openStep(id, "fwd"); else openMol([id]);
  }
  function annotTab() {
    var box = $("#annot"), d = doc(), rows = [], edit = Annot.canEdit, me = Annot.user ? Annot.user.login : null;
    Object.keys(d.status).forEach(function (k) {
      var q = k.split("|"), v = d.status[k];
      rows.push({ at: v.at, by: v.by, what: v.s === "yes" ? "✓ possible" : "✗ not possible", cls: v.s === "yes" ? "ok" : "bad", ch: q[0], id: q[1], note: v.note,
                  act: edit ? ["clear", function () { Annot.setStatus([k], null, ""); }] : null });
    });
    Object.keys(d.removed).forEach(function (k) {
      var q = k.split("|"), r = d.removed[k];
      rows.push({ at: r.at, by: r.by, what: "removed from the network", cls: "rmv", ch: q[0], id: q[1], note: r.note,
                  act: edit ? ["restore", function () { Annot.restore([k]); }] : null });
    });
    ["species", "steps", "mechanisms"].forEach(function (kind) {
      Object.keys(d[kind]).forEach(function (id) {
        var it = d[kind][id], note = it.name;
        if (kind === "steps") note = it.from + " → " + it.to + ": " + it.name + (it.desc ? " – " + it.desc : "");
        if (kind === "species") note = it.name + (it.smiles ? "  " + it.smiles : "");
        if (kind === "mechanisms") note = it.name + " (" + it.hops.length + " steps, ends at " + it.product + ")" + (it.desc ? " – " + it.desc : "");
        rows.push({ at: it.at, by: it.by, what: "added " + Annot.kinds[kind].word, cls: "usr", ch: it.ch.join(", "), id: id, note: note,
                    act: edit && it.by === me ? ["delete", function () {
                      var used = usersOf(id);
                      if (used.length) { toast(id + " is used by " + used.join(", ") + ": delete those first."); return; }
                      if (window.confirm("Delete " + id + " for good?")) Annot.del(kind, id);
                    }] : null });
      });
    });
    rows.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : nat(a.id, b.id); });
    box.textContent = "";
    var nv = Object.keys(d.status).length;
    var who = {};
    rows.forEach(function (r) { who[r.by] = 1; });
    var src = !Annot.loaded ? "Annotations unavailable" + (Annot.error ? " (" + Annot.error + ")" : "") + ": the site works without them." :
      "Read from " + Annot.cfg.owner + "/" + Annot.cfg.repo + ", branch " + Annot.cfg.branch + ", " + Annot.cfg.file +
      (Annot.source === "api" ? " (GitHub API, as @" + Annot.user.login + ")" : " (raw.githubusercontent.com; may lag a few minutes behind)") + ".";
    var blob = null;
    box.appendChild(h("div", { class: "annhead" }, [
      h("h2", null, ["Statuses and edits"]),
      h("p", null, [plural(nv, "status", "statuses") + ", " + plural(Object.keys(d.removed).length, "removal") + ", " + plural(Object.keys(d.steps).length, "added step") + ", " +
        plural(Object.keys(d.species).length, "added species", "added species") + " and " + plural(Object.keys(d.mechanisms).length, "added mechanism") +
        (rows.length ? ", by " + plural(Object.keys(who).length, "collaborator") : "") + "."]),
      h("p", { class: "note" }, [src]),
      h("div", { class: "row" }, [
        h("button", { class: "btn primary", onclick: function () {
          if (blob) URL.revokeObjectURL(blob);
          blob = URL.createObjectURL(new Blob([Annot.json()], { type: "application/json" }));
          var a = h("a", { href: blob, download: "annotations.json" });
          document.body.appendChild(a); a.click(); a.remove();
        } }, ["Download annotations.json"]),
        h("button", { class: "btn", onclick: function () { Annot.reload(); } }, ["Reload"]),
        Annot.user || !Annot.signInReady ? null : h("button", { class: "btn", onclick: function () { var b = $("#signin"); if (b) b.click(); } }, ["Sign in to mark and edit"])
      ])
    ]));
    if (!rows.length) { box.appendChild(h("p", { class: "hint" }, ["No statuses or edits yet."])); return; }
    var tb = h("tbody");
    rows.forEach(function (r) {
      tb.appendChild(h("tr", null, [
        h("td", { class: "when", title: r.at || null }, [day(r.at)]),
        h("td", null, ["@" + r.by]),
        h("td", { class: r.cls }, [r.what]),
        h("td", { class: "id" }, [h("a", { class: "lnk", onclick: function () { openItem(r.id, r.ch.length === 1 ? r.ch : null); } }, [r.id])]),
        h("td", null, [r.ch]),
        h("td", { class: "notecell" }, [r.note || ""]),
        h("td", null, [r.act ? h("button", { class: "btn small", onclick: r.act[1] }, [r.act[0]]) : null])
      ]));
    });
    box.appendChild(h("table", { class: "annt" }, [h("thead", null, [h("tr", null, ["when", "who", "what", "item", "Ch", "note", ""].map(function (t) { return h("th", null, [t]); }))]), tb]));
  }

  // ------------------------------------------------------------------ about
  function about() {
    var nm = Object.keys(M().mechanisms).length, ns = Object.keys(M().species).length, nt = Object.keys(M().steps).length;
    $("#about").innerHTML = "<h2>What this is</h2><p>The reaction network of the hydantoin study: " + Object.keys(META.families).length + " mechanism families, " + nm +
      " mechanisms (an A version ending at P1a = 1-R-3-Me and a B version ending at P1b = 1-Me-3-R), " + ns + " species and " + nt +
      " steps for each of the urea and the thiourea. Species and step IDs are the same as in the mechflow projects <code>Ch_O</code> and <code>Ch_S</code>.</p>" +
      "<h2>How to read the drawings</h2><p>Each step with a transition state has its own colour: the arrow between two structures and the curly arrows on the structure before it. " +
      "Above each coloured arrow is a 3D picture of a TS guess. Proton transfers are grey steps through the acid catalyst (HA drawn as A–H, A⁻ as A⁻), each with its own TS. Proton transfers and steps that release or take up water are drawn as equilibria (⇌). The green H is the aldehyde H (H4). " +
      "In a step's window the TS above the arrow is drawn in 2D, with the bonds that form or break dashed; <i>2D | 3D</i> swaps it for the 3D TS guess.</p>" +
      "<h2>TS guesses and paths</h2><p>For every step, the two sides were joined by an IDPP interpolation (ASE NEB module). One end is the structure mechflow starts the SCAN from; " +
      "the other is the same atoms with the step's bonds changed, relaxed with a force field. These are pictures and starting points, not DFT results. " +
      "The player runs from the step's left side to its right side; a step that a mechanism uses backwards is played backwards. " +
      "The xyz files are in <code>xyz/ts_guesses/</code> and open with <code>ase gui</code>.</p>" +
      "<h2>Statuses and edits</h2><p>Collaborators on the GitHub repository sign in with GitHub (top right) and mark mechanisms and steps as " +
      "possible or not possible, separately for the urea and the thiourea, with a short note if they like. Each item has one status: the last change " +
      "wins. A step marked not possible makes every mechanism that uses it not possible; a mechanism with no mark of its own whose steps are all " +
      "marked possible is possible; a mechanism marked possible that uses a step marked not possible is shown as a conflict. The badges say where a " +
      "status comes from (its own mark, or which steps). Collaborators can also take mechanisms and steps out of the network, add steps and species, " +
      "and build new mechanisms from the steps. Everyone sees all of it: as badges in the lists, in the step and mechanism views, and in the " +
      "Annotations tab, which can download it all as <code>annotations.json</code>. Right-click a step arrow, a mechanism or a network box for a " +
      "short menu.</p><p>The Network tab shows the network of the urea or the thiourea, with that chalcogen's statuses. <i>everything</i> shows " +
      "every step that has not been removed; <i>hide what is not possible</i> leaves out the steps marked not possible and the mechanisms that are " +
      "not possible, and then everything that no longer lies on a route from the reactants to a product; <i>grey out what is not possible</i> " +
      "shows everything but greys what <i>hide</i> would leave out. An arrow stays only while a mechanism that uses it is still allowed (or a " +
      "collaborator added it as a step). Added steps and species are drawn dashed in teal. " +
      "In the search box, <code>is:possible</code>, <code>is:notpossible</code>, <code>is:conflict</code>, <code>is:unmarked</code>, " +
      "<code>is:removed</code> and <code>is:added</code> filter the lists.</p>" +
      "<h2>After the DFT calculations</h2><p>Rebuild the site (<code>make_website.py</code>) and every step with a finished OptTS or IRC gets a “3D: DFT” tab.</p>";
  }

  // ------------------------------------------------------------------ top bar
  function setTab(t) {
    if (TABS.indexOf(t) < 0) return;
    S.tab = t;
    $$("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    $$(".tab").forEach(function (s) { s.classList.toggle("on", s.id === "tab-" + t); });
    if (t === "net") renderNet();
    if (t === "annot") annotTab();
  }
  function setCh(c) {
    if ((c !== "O" && c !== "S") || c === S.ch) return;
    S.ch = c;
    $$("#chsel button").forEach(function (b) { b.classList.toggle("on", b.dataset.ch === c); });
    famList(); tables(); about();
    if (S.mech) showMech(S.mech);
    if (S.tab === "net") renderNet();
    if (S.tab === "annot") annotTab();
    if (S.builder) S.builder.draw();
  }
  $("#tabs").addEventListener("click", function (e) { if (e.target.dataset.tab) setTab(e.target.dataset.tab); });
  $("#chsel").addEventListener("click", function (e) { if (e.target.dataset.ch) setCh(e.target.dataset.ch); });
  $("#q").addEventListener("input", function () {
    var q = query();
    famList(); tables(); if (S.tab === "net") netFind(q.text);
    var up = q.text.toUpperCase();
    if (up && !q.is && (baseMech(up) || userMech(up))) showMech(up);
  });
  window.addEventListener("resize", function () { if (S.zoom === "fit") zoom("fit"); });

  // ------------------------------------------------------------------ when the annotations change (load, own clicks, saves)
  var annotQ = null, firstLoad = true, H = Object.create(null);
  function onAnnot() {
    annotQ = null;
    renderAuth();
    $$(".vote").forEach(function (el) { renderStatus(el); });
    var moved = Annot.takeRemap(), notice = Annot.takeNotice();
    if (S.mech && moved[S.mech]) S.mech = moved[S.mech];
    if (notice) toast(notice);
    famList(); tables();
    if (S.mech && userMech(S.mech)) { if (JSON.stringify(userMech(S.mech)) !== S.umech) showUserMech(S.mech); }
    else if ($("#mechview .upage")) showMech(firstMech());
    if (S.tab === "annot") annotTab();
    if (S.tab === "net") renderNetSoon();
    if (S.builder) S.builder.draw();
    if (firstLoad && Annot.loaded) {          // links to the collaborators' items need the annotations first
      firstLoad = false;
      if (H.m && userMech(H.m)) showMech(H.m);
      if (H.step && userStep(H.step)) openStep(H.step);
      if (H.mol && H.mol.split(",").some(userSpecies)) openMol(H.mol.split(",").filter(userSpecies));
    }
  }
  Annot.onChange(function () { if (!annotQ) annotQ = setTimeout(onAnnot, 0); });

  // ------------------------------------------------------------------ start
  $("#netmode").value = S.netMode;
  $("#netremoved").checked = S.netRemoved;
  (function famRange() {           // " (M1–M54)" in the subtitle, from the families of the projects
    var f = Object.keys(META.families).sort(nat);
    if (f.length) $("#famrange").textContent = " (" + f[0] + (f.length > 1 ? "–" + f[f.length - 1] : "") + ")";
  })();
  famList(); tables(); about(); renderAuth();
  // deep links: #ch=S&m=M3A&step=S7b&dir=fwd&mol=I5a,R2&tab=net&filter=hide
  (location.hash || "").replace(/^#/, "").split("&").forEach(function (kv) {
    var q = kv.split("=");
    if (q[0]) { try { H[q[0]] = decodeURIComponent(q[1] || ""); } catch (e) { H[q[0]] = ""; } }
  });
  if (H.ch === "S" || H.ch === "O") { S.ch = H.ch; $$("#chsel button").forEach(function (b) { b.classList.toggle("on", b.dataset.ch === S.ch); }); famList(); tables(); about(); }
  if (MODES.indexOf(H.filter) >= 0) { S.netMode = H.filter; $("#netmode").value = S.netMode; }
  showMech(baseMech(H.m) ? H.m : firstMech());
  if (H.tab) setTab(H.tab);
  if (H.step) openStep(H.step, H.dir || "fwd");
  if (H.mol) openMol(H.mol.split(","));
  if (/^[a-z]$/.test(H.pane || "")) setTimeout(function () { var b = document.querySelector(".win .tabs button[data-p='" + H.pane + "']"); if (b) b.click(); }, 300);
  Annot.init();
})();
