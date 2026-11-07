/* Hydantoin Mechanism Explorer: mechanisms, network, species and steps of the two mechflow projects (Ch_O, Ch_S). */
(function () {
  "use strict";
  var S = { ch: "O", tab: "mech", mech: null, zoom: null, top: 100 };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var CHN = { O: "urea", S: "thiourea" };

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
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function chText(t) {
    var O = S.ch === "O";
    return String(t).replace(/iso\(thio\)urea/g, O ? "isourea" : "isothiourea").replace(/pseudo\(thio\)hydantoin/g, O ? "pseudohydantoin" : "pseudothiohydantoin")
      .replace(/iso\(thio\)cyanate/g, O ? "isocyanate" : "isothiocyanate").replace(/\(thio\)urea/g, O ? "urea" : "thiourea")
      .replace(/\(thio\)ureido/g, O ? "ureido" : "thioureido").replace(/O\/S-containing/g, O ? "O-containing" : "S-containing")
      .replace(/O\/S/g, O ? "O" : "S").replace(/imino-azolidin/g, O ? "imino-oxazolidin" : "imino-thiazolidin");
  }

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
    d.style.left = Math.min(80 + 32 * n, window.innerWidth - 420) + "px";
    d.style.top = Math.min(70 + 26 * n, window.innerHeight - 300) + "px";
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
  function viewer3d(el) {
    var v = $3Dmol.createViewer(el, { backgroundColor: "white" });
    return v;
  }
  function styleAll(v, mode) {
    if (mode === "line") v.setStyle({}, { line: { colorscheme: "Jmol" } });
    else if (mode === "spacefill") v.setStyle({}, { sphere: { colorscheme: "Jmol" } });
    else v.setStyle({}, { stick: { radius: 0.13, colorscheme: "Jmol" }, sphere: { scale: 0.24, colorscheme: "Jmol" } });
  }

  // ------------------------------------------------------------------ species in 3D
  function openMol(ids) {
    ids = ids.filter(function (s) { return XYZ[S.ch][s]; });
    if (!ids.length) return;
    var title = ids.join(" + ");
    var names = ids.map(function (s) { return chText(M().species[s].name); }).join(" + ");
    var body = makeWin(title, names + "  (" + CHN[S.ch] + ")", 640);
    body.innerHTML = "<div class='v3d'></div><div class='tools'><button data-a='labels'>Key atoms</button>" +
      "<button data-a='ball'>Ball &amp; stick</button><button data-a='line'>Lines</button><button data-a='spacefill'>Space-filling</button>" +
      "<span class='note'>drag to turn, scroll to zoom</span></div><div class='info'></div>";
    var v = viewer3d($(".v3d", body)), dx = 0, labels = [], show = false;
    ids.forEach(function (sid) {
      var f = frames(XYZ[S.ch][sid])[0], xs = f.atoms.map(function (a) { return a.x; });
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
      var sp = M().species[sid];
      return "<div><b>" + sid + "</b> " + esc(chText(sp.name)) + " &middot; " + esc(sp.formula) + " &middot; used by " + sp.used_by.length +
        " mechanisms &middot; <a href='xyz/species/Ch_" + S.ch + "/" + sid + ".xyz' download>xyz</a></div>";
    }).join("");
    $(".info", body).innerHTML = info + "<div class='note'>Starting structures (force field). Open an xyz file in ASE with <code>ase gui " + ids[0] + ".xyz</code>.</div>";
  }

  // ------------------------------------------------------------------ a step: diagram, 3D path (IDPP / ASE NEB), info
  function openStep(sid, dir) {
    var st = M().steps[sid];
    if (!st) return;
    dir = (dir === "rev" && st.rev) ? "rev" : "fwd";
    var body = makeWin(sid + (dir === "rev" ? " (backwards)" : ""), chText(st.name) + "  (" + CHN[S.ch] + ")", 900);
    body.innerHTML = "<div class='tabs'><button data-p='d' class='on'>Diagram</button><button data-p='p'>3D: TS guess and path</button>" +
      (st.dft.length ? "<button data-p='q'>3D: DFT</button>" : "") + "<button data-p='i'>Details</button></div>" +
      "<div class='pane on' data-p='d'><div class='svgbox'>loading&hellip;</div></div>" +
      "<div class='pane' data-p='p'><div class='v3d'></div><div class='tools'><button data-a='play'>&#9654; Play</button>" +
      "<input type='range' min='0' max='8' value='0'><span class='fr'></span><button data-a='ts'>TS guess</button>" +
      "<button data-a='labels'>Key atoms</button><a download>path .xyz (ase gui)</a></div>" +
      "<div class='info note'>Images from an IDPP interpolation (ASE NEB module) between the two sides of the step; the end that is not the " +
      "SCAN start was made by changing the bonds and relaxing with a force field. The image marked TS guess has the scanned distance nearest " +
      "a typical TS value. A picture and a starting idea, not a DFT result. Open the file with <code>ase gui " + sid + "_path.xyz</code>.</div></div>" +
      (st.dft.length ? "<div class='pane' data-p='q'><div class='v3d'></div><div class='tools'><input type='range' min='0' value='0'><span class='fr'></span></div></div>" : "") +
      "<div class='pane' data-p='i'><div class='info'></div></div>";
    var tabs = $(".tabs", body);
    tabs.addEventListener("click", function (e) {
      var p = e.target.dataset.p; if (!p) return;
      $$(".tabs button", body).forEach(function (b) { b.classList.toggle("on", b.dataset.p === p); });
      $$(".pane", body).forEach(function (b) { b.classList.toggle("on", b.dataset.p === p); });
      if (p === "p") showPath(); if (p === "q") showDFT();
    });
    load("step", S.ch, sid + "_" + dir).then(function (svg) { $(".pane[data-p=d] .svgbox", body).innerHTML = svg; })
      .catch(function () { $(".pane[data-p=d] .svgbox", body).textContent = "No drawing for this step."; });
    var mechs = st.used_by.filter(function (m) { return META.ch[S.ch].mechanisms[m]; });
    $(".pane[data-p=i] .info", body).innerHTML = "<p><b>Reaction:</b> " + esc(st.reaction) + "</p>" +
      "<p><b>SCAN in mechflow:</b> atoms " + st.scan.atoms.join(", ") + " (from " + st.start + "), " + (st.scan.mode === "stretch" ? "stretched" : "brought together") +
      " from " + st.scan.d0 + " to " + st.scan.to + " &Aring;.</p><p><b>Used by:</b> " +
      (mechs.length ? mechs.map(function (m) { return "<a data-m='" + m + "'>" + m + "</a>"; }).join(", ") : "no mechanism") + "</p>" +
      "<p class='note'>DFT results appear here after the calculations, once the website is rebuilt.</p>";
    $(".pane[data-p=i] .info", body).addEventListener("click", function (e) { if (e.target.dataset.m) { setTab("mech"); showMech(e.target.dataset.m); } });

    var pv = null;
    function showPath() {
      if (pv) return;
      load("path", S.ch, sid).then(function (P) {
        var pane = $(".pane[data-p=p]", body), fr = frames(P.xyz), v = viewer3d($(".v3d", pane));
        pv = v;
        v.addModelsAsFrames(P.xyz, "xyz"); styleAll(v, "ball"); v.zoomTo();
        var slider = $("input[type=range]", pane), lab = $(".fr", pane), k = 0, timer = null, labels = false;
        var ka = keyAtoms(XYZ[S.ch][st.start].split(/\r?\n/)[1]);
        slider.max = fr.length - 1;
        $("a[download]", pane).href = "xyz/ts_guesses/Ch_" + S.ch + "/" + sid + "_path.xyz";
        function draw() {
          var f = fr[k];
          Promise.resolve(v.setFrame(k)).then(function () {
            v.removeAllShapes(); v.removeAllLabels();
            (P.changed || []).forEach(function (pr) {
              var a = f.atoms[pr[0]], b = f.atoms[pr[1]];
              v.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: { x: b.x, y: b.y, z: b.z }, radius: 0.08, color: st.colour, dashed: true, fromCap: 1, toCap: 1 });
            });
            if (labels) Object.keys(ka).forEach(function (i) { var a = f.atoms[+i]; v.addLabel(ka[i], { position: { x: a.x, y: a.y, z: a.z }, fontSize: 11, fontColor: "black", backgroundColor: "white", backgroundOpacity: 0.75, inFront: true }); });
            v.render();
          });
          slider.value = k;
          lab.textContent = "image " + k + "/" + (fr.length - 1) + (k === P.ts ? "  (TS guess)" : "") + (P.d[k] !== undefined ? "  d = " + P.d[k].toFixed(2) + " Å" : "");
        }
        k = P.ts || 0; draw();
        slider.oninput = function () { k = +slider.value; draw(); };
        $(".tools", pane).addEventListener("click", function (e) {
          var a = e.target.dataset.a;
          if (a === "ts") { k = P.ts || 0; draw(); }
          if (a === "labels") { labels = !labels; draw(); }
          if (a === "play") {
            if (timer) { clearInterval(timer); timer = null; e.target.innerHTML = "&#9654; Play"; return; }
            e.target.innerHTML = "&#10073;&#10073; Pause";
            timer = setInterval(function () { k = (k + 1) % fr.length; draw(); }, 420);
          }
        });
      }).catch(function () { $(".pane[data-p=p]", body).innerHTML = "<div class='info'>No path for this step.</div>"; });
    }
    function showDFT() {
      load("dft", S.ch, sid).then(function (D) {
        var pane = $(".pane[data-p=q]", body), v = viewer3d($(".v3d", pane)), txt = D.irc || D.ts;
        v.addModelsAsFrames(txt, "xyz"); styleAll(v, "ball"); v.zoomTo(); v.render();
        var fr = frames(txt), slider = $("input[type=range]", pane);
        slider.max = fr.length - 1;
        slider.oninput = function () { Promise.resolve(v.setFrame(+slider.value)).then(function () { v.render(); }); $(".fr", pane).textContent = (D.irc ? "IRC image " : "TS ") + slider.value; };
      });
    }
  }

  // ------------------------------------------------------------------ mechanisms tab
  var GROUP_ORDER = ["redox in the imidazolidinone ring", "redox in the open chain, (thio)urea bonded through N",
    "redox in the open chain, (thio)urea bonded through O/S", "redox in an O/S-containing ring", "redox before the (thio)urea reacts (mandelic acid)"];
  function famList() {
    var q = ($("#q").value || "").toLowerCase(), F = META.families, groups = {};
    Object.keys(F).sort(function (a, b) { return +a.slice(1) - +b.slice(1); }).forEach(function (f) {
      var t = chText(F[f].text), g = F[f].group;
      if (q && (f + " " + t + " " + g).toLowerCase().indexOf(q) < 0 && !matchStep(f, q)) return;
      (groups[g] = groups[g] || []).push([f, t]);
    });
    var h = "";
    GROUP_ORDER.forEach(function (g) {
      if (!groups[g]) return;
      h += "<div class='group'><h3>" + esc(chText(g)) + "</h3>";
      groups[g].forEach(function (x) {
        var on = S.mech && S.mech.slice(0, -1) === x[0];
        h += "<div class='fam" + (on ? " on" : "") + "' data-f='" + x[0] + "'><span class='id'>" + x[0] + "</span><span class='txt'>" + esc(x[1]) +
          "</span><div class='ab'><button data-m='" + x[0] + "A'" + (S.mech === x[0] + "A" ? " class='on'" : "") + ">A &rarr; P1a</button><button data-m='" + x[0] + "B'" +
          (S.mech === x[0] + "B" ? " class='on'" : "") + ">B &rarr; P1b</button></div></div>";
      });
      h += "</div>";
    });
    $("#famlist").innerHTML = h || "<div class='hint'>Nothing matches.</div>";
  }
  function matchStep(f, q) {
    var ms = [f + "A", f + "B"];
    return ms.some(function (m) { var mm = M().mechanisms[m]; return mm && mm.steps.some(function (s) { return s.toLowerCase() === q; }); });
  }
  function showMech(mid) {
    S.mech = mid; famList();
    var mm = M().mechanisms[mid];
    $("#mechtitle").textContent = mid + ": " + chText(mm ? mm.name : "") + "  (" + CHN[S.ch] + ")";
    $("#mechview").innerHTML = "<div class='hint'>loading&hellip;</div>";
    load("mech", S.ch, mid).then(function (svg) { $("#mechview").innerHTML = svg; zoom(S.zoom || "fit"); });
  }
  function zoom(z) {
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
    var b = e.target.closest("button[data-m]"); if (b) { showMech(b.dataset.m); return; }
    var f = e.target.closest(".fam"); if (f) showMech(f.dataset.f + "A");
  });
  $("#mechview").addEventListener("click", function (e) {
    var lk = e.target.closest(".lk"); if (lk) { openStep(lk.dataset.step, lk.dataset.dir); return; }
    var sp = e.target.closest(".sp"); if (sp) openMol(sp.dataset.ids.split(" "));
  });
  $$(".zoombar button[data-z]").forEach(function (b) { b.onclick = function () { zoom(b.dataset.z); }; });

  // ------------------------------------------------------------------ network tab (pan / zoom)
  var net = { vb: null, el: null };
  function buildNet() {
    if (net.el) return;
    var box = $("#netview");
    box.innerHTML = NETWORK_SVG;
    var svg = $("svg", box);
    svg.removeAttribute("width"); svg.removeAttribute("height"); svg.style.width = "100%"; svg.style.height = "100%";
    net.el = svg; net.full = svg.viewBox.baseVal; net.vb = [net.full.x, net.full.y, net.full.width, net.full.height];
    netFit();
    var drag = null;
    box.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, vb: net.vb.slice(), moved: false }; });
    box.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var r = box.getBoundingClientRect(), s = net.vb[2] / r.width;
      var dx = (e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      net.vb[0] = drag.vb[0] - dx; net.vb[1] = drag.vb[1] - dy; setVB();
    });
    box.addEventListener("pointerup", function (e) {
      var d = drag; drag = null;
      if (d && d.moved) return;
      var g = e.target.closest("g.node, g.edge"); if (!g) return;
      var id = g.id || "";
      if (id.indexOf("sp|") === 0) openMol(id.slice(3).split(" "));
      if (id.indexOf("st|") === 0) { var q = id.split("|"); openStep(q[1], q[2]); }
    });
    box.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = box.getBoundingClientRect(), f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      var mx = net.vb[0] + (e.clientX - r.left) / r.width * net.vb[2], my = net.vb[1] + (e.clientY - r.top) / r.height * net.vb[3];
      net.vb[2] *= f; net.vb[3] *= f; net.vb[0] = mx - (e.clientX - r.left) / r.width * net.vb[2]; net.vb[1] = my - (e.clientY - r.top) / r.height * net.vb[3];
      setVB();
    }, { passive: false });
    var lg = "<b>Arrow colour: where the redox happens</b>";
    Object.keys(NETWORK_GROUPS).forEach(function (g) { lg += "<div><i style='background:" + NETWORK_GROUPS[g] + "'></i>" + esc(chText(g)) + "</div>"; });
    $("#netlegend").innerHTML = lg + "<div class='note'>Structures drawn with S; Ch = O or S.</div>";
  }
  function setVB() { net.el.setAttribute("viewBox", net.vb.join(" ")); }
  function netFit() {
    var box = $("#netview").getBoundingClientRect(), f = net.full, ar = box.width / Math.max(box.height, 1);
    var w = f.width, h = f.height;
    if (w / h > ar) h = w / ar; else w = h * ar;
    net.vb = [f.x - (w - f.width) / 2, f.y - (h - f.height) / 2, w, h]; setVB();
  }
  function netFind(q) {
    if (!net.el) return;
    $$("g.hl", net.el).forEach(function (g) { g.classList.remove("hl"); });
    if (!q) return;
    var hit = $$("g.node", net.el).filter(function (g) { return (" " + g.id.slice(3) + " ").toLowerCase().indexOf(" " + q + " ") >= 0; });
    hit.forEach(function (g) { g.classList.add("hl"); });
    if (hit.length) {
      var b = hit[0].getBBox(), w = Math.max(b.width * 6, 900), box = $("#netview").getBoundingClientRect();
      net.vb = [b.x + b.width / 2 - w / 2, b.y + b.height / 2 - w * box.height / box.width / 2, w, w * box.height / box.width]; setVB();
    }
  }
  $$(".zoombar button[data-nz]").forEach(function (b) {
    b.onclick = function () {
      if (b.dataset.nz === "fit") { netFit(); return; }
      var f = b.dataset.nz === "+" ? 1 / 1.3 : 1.3, cx = net.vb[0] + net.vb[2] / 2, cy = net.vb[1] + net.vb[3] / 2;
      net.vb[2] *= f; net.vb[3] *= f; net.vb[0] = cx - net.vb[2] / 2; net.vb[1] = cy - net.vb[3] / 2; setVB();
    };
  });

  // ------------------------------------------------------------------ tables
  function tables() {
    var q = ($("#q").value || "").toLowerCase();
    var sp = M().species, rows = "";
    Object.keys(sp).forEach(function (s) {
      var t = (s + " " + sp[s].name).toLowerCase(); if (q && t.indexOf(q) < 0) return;
      rows += "<tr data-s='" + s + "'><td class='id'>" + s + "</td><td>" + esc(chText(sp[s].name)) + "</td><td>" + esc(sp[s].formula) + "</td><td>" +
        sp[s].used_by.length + "</td></tr>";
    });
    $("#sptable").innerHTML = "<thead><tr><th>ID</th><th>name</th><th>formula</th><th>mechanisms</th></tr></thead><tbody>" + rows + "</tbody>";
    var st = M().steps; rows = "";
    Object.keys(st).forEach(function (s) {
      var t = (s + " " + st[s].name + " " + st[s].reaction).toLowerCase(); if (q && t.indexOf(q) < 0) return;
      rows += "<tr data-t='" + s + "'><td class='id' style='color:" + st[s].colour + "'>" + s + "</td><td>" + esc(chText(st[s].name)) + "</td><td>" + esc(st[s].reaction) +
        "</td><td>" + st[s].used_by.filter(function (m) { return M().mechanisms[m]; }).length + "</td></tr>";
    });
    $("#sttable").innerHTML = "<thead><tr><th>ID</th><th>what happens</th><th>reaction</th><th>mechanisms</th></tr></thead><tbody>" + rows + "</tbody>";
  }
  $("#sptable").addEventListener("click", function (e) { var r = e.target.closest("tr[data-s]"); if (r) openMol([r.dataset.s]); });
  $("#sttable").addEventListener("click", function (e) { var r = e.target.closest("tr[data-t]"); if (r) openStep(r.dataset.t, "fwd"); });

  // ------------------------------------------------------------------ about
  function about() {
    var nm = Object.keys(M().mechanisms).length, ns = Object.keys(M().species).length, nt = Object.keys(M().steps).length;
    $("#about").innerHTML = "<h2>What this is</h2><p>The reaction network of the hydantoin study: " + Object.keys(META.families).length + " mechanism families, " + nm +
      " mechanisms (an A version ending at P1a = 1-R-3-Me and a B version ending at P1b = 1-Me-3-R), " + ns + " species and " + nt +
      " steps for each of the urea and the thiourea. Species and step IDs are the same as in the mechflow projects <code>Ch_O</code> and <code>Ch_S</code>.</p>" +
      "<h2>How to read the drawings</h2><p>Each step with a transition state has its own colour: the arrow between two structures and the curly arrows on the structure before it. " +
      "Above each coloured arrow is a 3D picture of a TS guess. Grey double arrows are proton transfers, which are fast equilibria with no TS in the model. The green H is the aldehyde H (H4).</p>" +
      "<h2>TS guesses and paths</h2><p>For every step, the two sides were joined by an IDPP interpolation (ASE NEB module, 9 images). One end is the structure mechflow starts the SCAN from; " +
      "the other is the same atoms with the step's bonds changed, relaxed with a force field. These are pictures and starting points, not DFT results. " +
      "The xyz files are in <code>xyz/ts_guesses/</code> and open with <code>ase gui</code>.</p>" +
      "<h2>After the DFT calculations</h2><p>Rebuild the site (<code>make_website.py</code>) and every step with a finished OptTS or IRC gets a “3D: DFT” tab.</p>";
  }

  // ------------------------------------------------------------------ top bar
  function setTab(t) {
    S.tab = t;
    $$("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    $$(".tab").forEach(function (s) { s.classList.toggle("on", s.id === "tab-" + t); });
    if (t === "net") { buildNet(); netFind(($("#q").value || "").toLowerCase()); }
  }
  $("#tabs").addEventListener("click", function (e) { if (e.target.dataset.tab) setTab(e.target.dataset.tab); });
  $("#chsel").addEventListener("click", function (e) {
    var c = e.target.dataset.ch; if (!c || c === S.ch) return;
    S.ch = c; $$("#chsel button").forEach(function (b) { b.classList.toggle("on", b.dataset.ch === c); });
    famList(); tables(); about(); if (S.mech) showMech(S.mech);
  });
  $("#q").addEventListener("input", function () {
    var q = ($("#q").value || "").trim().toLowerCase();
    famList(); tables(); if (S.tab === "net") netFind(q);
    if (/^m\d+[ab]$/.test(q) && M().mechanisms[q.toUpperCase()]) showMech(q.toUpperCase());
  });
  window.addEventListener("resize", function () { if (S.zoom === "fit") zoom("fit"); });
  famList(); tables(); about();
  // deep links: #ch=S&m=M3A&step=S7b&dir=fwd&mol=I5a,R2&tab=net
  var H = {};
  (location.hash || "").replace(/^#/, "").split("&").forEach(function (kv) { var q = kv.split("="); if (q[0]) H[q[0]] = decodeURIComponent(q[1] || ""); });
  if (H.ch === "S" || H.ch === "O") { S.ch = H.ch; $$("#chsel button").forEach(function (b) { b.classList.toggle("on", b.dataset.ch === S.ch); }); famList(); tables(); about(); }
  showMech(H.m && M().mechanisms[H.m] ? H.m : "M1A");
  if (H.tab) setTab(H.tab);
  if (H.step) openStep(H.step, H.dir || "fwd");
  if (H.mol) openMol(H.mol.split(","));
  if (H.pane) setTimeout(function () { var b = document.querySelector(".win .tabs button[data-p='" + H.pane + "']"); if (b) b.click(); }, 300);
})();
