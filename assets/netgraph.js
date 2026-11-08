/* Hydantoin Mechanism Explorer: the network as data (window.NetGraph).

   data/network_graph_O.js and _S.js (written by make_website.py) hold the states (boxes) and arrows of the network of
   each chalcogen (NETWORK_GRAPH.O, NETWORK_GRAPH.S), with the mechanisms that use each arrow. Here the collaborators' additions are put in, the network is filtered by the
   statuses, and a filtered or edited network is laid out again in the browser with Graphviz (Viz.js, WebAssembly, loaded only
   when needed). The element ids are those of the pre-rendered network: "sp|I5a" for a state, "st|S7b|fwd" for a step;
   every box and arrow also has a class "k-<name>" (boxes) or "k-e<index>" (arrows). */
(function () {
  "use strict";
  var USER_COL = "#00897b", USER_FILL = "#e0f2f1";
  var vizP = null, cache = [];

  function has(o, k) { return !!o && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k); }
  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function dotStr(t) { return esc(String(t).replace(/[\r\n\t]+/g, " ")).replace(/\\/g, "\\\\"); }
  function wrap(t, n, rows) {
    var cs = Array.from(String(t)), out = [];
    for (var k = 0; k < cs.length && out.length < rows; k += n) out.push(esc(cs.slice(k, k + n).join("")));
    if (cs.length > n * rows) out[out.length - 1] += "…";
    return out.join("<BR/>");
  }

  // ------------------------------------------------------------------ states written as "I2 + I132a" or "2 P1a"
  function parseState(s) {
    if (typeof s !== "string" || !window.Annot.stateRe.test(s)) return null;
    var counts = {}, ids = [];
    s.split(" + ").forEach(function (t) {
      var m = /^(?:(\d+) )?(.+)$/.exec(t);
      if (!counts[m[2]]) ids.push(m[2]);
      counts[m[2]] = (counts[m[2]] || 0) + (m[1] ? +m[1] : 1);
    });
    return { ids: ids, counts: counts };
  }
  function canon(p) { return p.ids.slice().sort().map(function (i) { return i + "*" + p.counts[i]; }).join("|"); }

  // ------------------------------------------------------------------ the graph of one chalcogen, with the additions
  function model(ch, doc, meta) {
    var NG = window.NETWORK_GRAPH[ch], nodes = [], edges = [], byName = {}, byCanon = {}, byEdge = {};
    NG.nodes.forEach(function (n) {
      var node = { i: nodes.length, name: n.n, key: n.key, sp: n.sp.slice(), label: n.label, kind: n.kind, img: n.img,
                   w: n.w, h: n.h, pw: n.pw, ph: n.ph, fill: n.fill, user: null };
      nodes.push(node);
      byName[n.n] = node;
      var p = parseState(n.key);
      if (p && !byCanon[canon(p)]) byCanon[canon(p)] = node;
    });
    function addEdge(e) {
      e.i = edges.length;
      edges.push(e);
      byEdge[e.from + ">" + e.to + ">" + (e.step || "")] = e;
      return e;
    }
    NG.edges.forEach(function (e) {
      addEdge({ from: byName[e.from].i, to: byName[e.to].i, step: e.step, dir: e.dir, colour: e.colour, name: e.name,
                mechs: e.mechs.slice(), eq: e.eq === true, both: e.both === true, free: e.free === true,
                dash: e.free === true && e.pt !== true, base: true, user: null });
    });
    var nBase = nodes.length, eBase = edges.length;
    function speciesInfo(id) {
      if (has(doc.species, id)) { var u = doc.species[id]; return { id: id, name: u.name, smiles: u.smiles, by: u.by, user: true }; }
      return { id: id, name: has(meta.species, id) ? meta.species[id].name : "(unknown species)", user: false };
    }
    function nodeFor(st) {
      var p = parseState(st);
      if (!p) return null;
      var c = canon(p);
      if (byCanon[c]) return byCanon[c];
      var info = p.ids.map(speciesInfo), node = {
        i: nodes.length, name: "u" + nodes.length, key: st, sp: p.ids, label: st, img: null,
        kind: p.ids.every(function (s) { return has(meta.species, s) && meta.species[s].role === "product"; }) ? "product" : "other",
        user: { species: info, by: (info.filter(function (s) { return s.user; })[0] || {}).by || "" }
      };
      nodes.push(node);
      byCanon[c] = node;
      return node;
    }
    Object.keys(doc.steps).forEach(function (id) {
      var st = doc.steps[id];
      if (st.ch.indexOf(ch) < 0) return;
      var a = nodeFor(st.from), b = nodeFor(st.to);
      if (!a || !b || a === b) return;
      addEdge({ from: a.i, to: b.i, step: id, dir: "fwd", colour: USER_COL, name: st.name, mechs: [], base: false,
                user: { kind: "step", id: id, by: st.by } });
    });
    Object.keys(doc.mechanisms).forEach(function (mid) {
      var m = doc.mechanisms[mid];
      if (m.ch.indexOf(ch) < 0) return;
      m.hops.forEach(function (h) {
        var a = nodeFor(h.from), b = nodeFor(h.to);
        if (!a || !b || a === b) return;
        var e = byEdge[a.i + ">" + b.i + ">" + (h.step || "")];
        if (!e) {                                   // a step used the other way round, or a new proton transfer
          var nm = !h.step ? "proton transfer" : has(doc.steps, h.step) ? doc.steps[h.step].name :
            has(meta.steps, h.step) ? meta.steps[h.step].name : h.step;
          e = addEdge({ from: a.i, to: b.i, step: h.step, dir: h.dir, colour: USER_COL, name: nm, mechs: [], base: false,
                        user: { kind: "hop", id: mid, by: m.by } });
        }
        if (e.mechs.indexOf(mid) < 0) e.mechs.push(mid);
      });
    });
    return { ch: ch, nodes: nodes, edges: edges, nBase: nBase, eBase: eBase, nodeFor: nodeFor,
             find: function (st) { var p = parseState(st); return p ? byCanon[canon(p)] || null : null; } };
  }

  // ------------------------------------------------------------------ what is shown
  /* o.mode: "all" | "hide" (hide what is not possible); o.showRemoved: removed items count as there. o.removed(id),
     o.stepStatus(id) -> "yes" | "no" | "none" (a step's own mark) and o.mechStatus(id) -> "yes" | "no" | "conflict" |
     "none" (a mechanism's shown status, with its steps' marks spread to it) are for the chalcogen of the graph.
     "all": an arrow needs a mechanism that is not removed (a step added by a collaborator needs none); everything that
     is not removed is kept, less what a removal cuts off from every route from the reactants to a product (a new step
     that does not reach a product yet is still shown).
     "hide": also leaves out the steps marked not possible and the mechanisms that are not possible, then keeps only
     what lies on a route from the reactants (R1 + R2) to a product. ("grey out what is not possible" on the page draws
     "all" and greys what "hide" would leave out.) */
  function onRoutes(G, edgeOK, nodeOK) {
    var out = G.nodes.map(function () { return []; }), inc = G.nodes.map(function () { return []; });
    G.edges.forEach(function (e, i) {
      if (!edgeOK[i]) return;
      out[e.from].push(e.to); inc[e.to].push(e.from);
      if (e.both) { out[e.to].push(e.from); inc[e.from].push(e.to); }     // a step that mechanisms use both ways round
    });
    function reach(seeds, adj) {
      var seen = G.nodes.map(function () { return false; }), todo = [];
      seeds.forEach(function (i) { if (nodeOK[i]) { seen[i] = true; todo.push(i); } });
      while (todo.length) {
        adj[todo.pop()].forEach(function (j) { if (!seen[j] && nodeOK[j]) { seen[j] = true; todo.push(j); } });
      }
      return seen;
    }
    var starts = [], prods = [];
    G.nodes.forEach(function (n, i) { if (n.kind === "start") starts.push(i); if (n.kind === "product") prods.push(i); });
    var f = reach(starts, out), b = reach(prods, inc);
    return { node: G.nodes.map(function (n, i) { return f[i] && b[i]; }),
             edge: G.edges.map(function (e, i) {
               return !!edgeOK[i] && ((f[e.from] && b[e.to]) || (!!e.both && f[e.to] && b[e.from]));
             }) };
  }
  function visible(G, o) {
    var hide = o.mode === "hide", mCache = {};
    function rm(id) { return !o.showRemoved && !!o.removed(id); }
    function mech(m) { if (!has(mCache, m)) mCache[m] = o.mechStatus(m); return mCache[m]; }
    var nodeOK = G.nodes.map(function () { return true; });
    var edgeOK = G.edges.map(function (e) {
      if (e.free === true) return false;           // steps that no mechanism uses come in below
      if (e.step && rm(e.step)) return false;
      var userStep = !!(e.user && e.user.kind === "step"), live = e.mechs.filter(function (m) { return !rm(m); });
      if (!hide) return userStep || live.length > 0;
      if (e.step && o.stepStatus(e.step) === "no") return false;
      return userStep || live.some(function (m) { return mech(m) !== "no"; });
    });
    var freeOK = G.edges.map(function (e) {
      return e.free === true && !(e.step && rm(e.step)) && !(hide && e.step && o.stepStatus(e.step) === "no");
    });
    var cur = onRoutes(G, edgeOK, nodeOK), vis;
    if (hide) vis = cur;
    else {
      var every = onRoutes(G, G.edges.map(function (e) { return e.free !== true; }), nodeOK);
      var ev = G.edges.map(function (e, i) { return edgeOK[i] && (cur.edge[i] || !every.edge[i]); });
      var nv = G.nodes.map(function (n) { return !n.user && (n.kind === "start" || n.kind === "product"); });
      G.edges.forEach(function (e, i) { if (ev[i]) nv[e.from] = nv[e.to] = true; });
      vis = { node: nv, edge: ev };
    }
    return withFree(G, vis, freeOK);
  }
  /* A step that no mechanism uses (e.g. A- bonded to a cation) is shown when each of its two boxes is shown, or is a
     box that only such steps reach; it takes no part in the routes. */
  function withFree(G, vis, freeOK) {
    var onlyFree = G.nodes.map(function () { return true; });
    G.edges.forEach(function (e) { if (e.free !== true) onlyFree[e.from] = onlyFree[e.to] = false; });
    var node = vis.node.slice(), edge = vis.edge.slice();
    G.edges.forEach(function (e, i) {
      if (!freeOK[i]) return;
      if ((vis.node[e.from] || onlyFree[e.from]) && (vis.node[e.to] || onlyFree[e.to])) {
        edge[i] = true;
        node[e.from] = node[e.to] = true;
      }
    });
    return { node: node, edge: edge };
  }
  function isFull(G, vis) {
    for (var i = 0; i < G.nodes.length; i++) if (vis.node[i] !== (i < G.nBase)) return false;
    for (var k = 0; k < G.edges.length; k++) if (vis.edge[k] !== (k < G.eBase)) return false;
    return true;
  }

  // ------------------------------------------------------------------ Graphviz source (same lines as make_website.py)
  function baseLabel(n) {
    return '<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4" BGCOLOR="' + n.fill + '" COLOR="#999999">' +
      (n.img ? '<TR><TD FIXEDSIZE="TRUE" WIDTH="' + n.w + '" HEIGHT="' + n.h + '"><IMG SRC="' + n.img + '" SCALE="TRUE"/></TD></TR>' : "") +
      '<TR><TD><B><FONT POINT-SIZE="24">' + esc(n.label) + '</FONT></B></TD></TR></TABLE>';
  }
  function userLabel(n) {
    var rows = ['<TR><TD><B><FONT POINT-SIZE="24">' + esc(n.label) + '</FONT></B></TD></TR>'];
    n.user.species.forEach(function (s) {
      rows.push('<TR><TD><FONT POINT-SIZE="15">' + wrap(s.id + ": " + s.name, 30, 3) + '</FONT></TD></TR>');
      if (s.smiles) rows.push('<TR><TD><FONT POINT-SIZE="13" FACE="Courier">' + wrap(s.smiles, 30, 4) + '</FONT></TD></TR>');
    });
    if (n.user.by) rows.push('<TR><TD><FONT POINT-SIZE="12" COLOR="' + USER_COL + '">added by @' + esc(n.user.by) + '</FONT></TD></TR>');
    return '<TABLE BORDER="2" STYLE="dashed" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4" BGCOLOR="' + USER_FILL + '" COLOR="' +
      USER_COL + '">' + rows.join("") + '</TABLE>';
  }
  /* grey: {node, edge} drawn greyed as removed (class rm); np: the same, greyed as not possible (class np) */
  function dot(G, vis, grey, np) {
    var NG = window.NETWORK_GRAPH[G.ch], L = ["digraph net {"].concat(NG.head);
    function mark(set, i, kind, c) { return set && set[kind][i] ? " " + c : ""; }
    G.nodes.forEach(function (n, i) {
      if (!vis.node[i]) return;
      var cls = "k-" + n.name + (n.user ? " usr" : "") + mark(grey, i, "node", "rm") + mark(np, i, "node", "np");
      L.push(n.name + ' [id="sp|' + n.sp.join(" ") + '", class="' + cls + '", label=<' + (n.user ? userLabel(n) : baseLabel(n)) + '>];');
    });
    G.edges.forEach(function (e, i) {
      if (!vis.edge[i]) return;
      var a = G.nodes[e.from].name, b = G.nodes[e.to].name, cls = "k-e" + i + (e.user ? " usr" : "") + mark(grey, i, "edge", "rm") + mark(np, i, "edge", "np");
      var head = a + " -> " + b + " [";
      if (e.step === null) {
        L.push(head + 'id="pt|' + a + "|" + b + '", class="' + cls + '", style=dashed, color="' + (e.base ? NG.pt_colour : USER_COL) +
               '", dir=none, penwidth=' + (e.base ? "1.6" : "2.4") + "];");
      } else if (e.base) {
        L.push(head + 'id="st|' + e.step + "|" + e.dir + '", class="' + cls + '", color="' + e.colour + '", fontcolor="' + e.colour +
               '", ' + (e.dash ? "style=dashed, " : "") + (e.eq === true || e.both === true ? "dir=both, " : "") + 'label=<<B>' +
               esc(e.step) + '</B>>, tooltip="' + dotStr(e.name) + '"];');
      } else {
        L.push(head + 'id="st|' + e.step + "|" + e.dir + '", class="' + cls + '", style=dashed, color="' + USER_COL + '", fontcolor="' +
               USER_COL + '", penwidth=2.8, label=<<B>' + esc(e.step + (e.dir === "rev" && e.user.kind === "hop" ? " (back)" : "")) +
               '</B>>, tooltip="' + dotStr(e.name) + '"];');
      }
    });
    L.push("}");
    return L.join("\n");
  }

  // ------------------------------------------------------------------ layout in the browser (Viz.js, loaded on first use)
  function loadViz() {
    if (!vizP) {
      vizP = new Promise(function (res, rej) {
        if (window.Viz) { res(); return; }
        var s = document.createElement("script");
        s.src = "assets/viz-global.js";
        s.onload = res;
        s.onerror = function () { rej(new Error("could not load assets/viz-global.js")); };
        document.head.appendChild(s);
      }).then(function () { return window.Viz.instance(); });
      vizP.catch(function () { vizP = null; });
    }
    return vizP;
  }
  function sanitize(root) {        // the SVG comes from Graphviz, which escapes text; drop anything active anyway
    Array.prototype.slice.call(root.querySelectorAll("script, foreignObject, iframe, object, embed, style, use")).forEach(function (x) { x.remove(); });
    Array.prototype.slice.call(root.querySelectorAll("*")).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n.indexOf("on") === 0) el.removeAttribute(a.name);
        else if (/(^|:)href$/.test(n) && !(el.localName === "image" && /^img\/net\/[OS]\/n\d+\.png$/.test(a.value))) el.removeAttribute(a.name);
      });
    });
    return root;
  }
  function toElement(svg) {
    var el = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    if (!el || el.localName !== "svg") throw new Error("Graphviz did not return a picture");
    return document.importNode(sanitize(el), true);
  }
  function render(G, vis, src) {
    for (var k = 0; k < cache.length; k++) if (cache[k].src === src) return Promise.resolve(toElement(cache[k].svg));
    return loadViz().then(function (viz) {
      var imgs = [], seen = {};
      G.nodes.forEach(function (n, i) {
        if (vis.node[i] && n.img && !seen[n.img]) { seen[n.img] = 1; imgs.push({ name: n.img, width: n.pw + "px", height: n.ph + "px" }); }
      });
      var svg = viz.renderString(src, { format: "svg", images: imgs });
      cache.push({ src: src, svg: svg });
      if (cache.length > 8) cache.shift();
      return toElement(svg);
    });
  }

  window.NetGraph = { USER_COL: USER_COL, parseState: parseState, canon: canon, model: model, visible: visible, isFull: isFull,
                      dot: dot, render: render, loadViz: loadViz };
})();
