/* AI Cyber Watch — renders data/*.json. No build step, no dependencies.
   All strings from data files are inserted with textContent (they originate from the web). */
(() => {
  "use strict";

  const CATS = {
    ga: { label: "Generally available", short: "GA", color: "var(--cat-ga)" },
    gated: { label: "Gated cyber", short: "Gated", color: "var(--cat-gated)" },
    open: { label: "Open-weight", short: "Open", color: "var(--cat-open)" },
  };
  const SEV = {
    critical: { label: "Critical", color: "var(--critical)", icon: "!" },
    serious: { label: "Serious", color: "var(--serious)", icon: "▲" },
    warning: { label: "Warning", color: "var(--warning)", icon: "!" },
    info: { label: "Info", color: "var(--info)", icon: "i" },
  };
  const TYPE_LABEL = { breakout: "Breakout", misuse: "Misuse", policy: "Policy" };
  const KIND_ICON = { official: "🏛", article: "📰", blog: "✍️", podcast: "🎙", social: "💬", paper: "📄" };
  const DAY = 86400000;

  const state = { cat: "all", prov: "", showOld: false, sort: { key: "index", dir: -1 }, open: new Set(), bench: "exploitgym" };
  let D = null;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);
  function link(title, url) {
    const u = safeUrl(url);
    return u ? h("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: title }) : h("span", { text: title });
  }
  const parseDate = (d) => (d ? new Date(d + (d.length === 10 ? "T00:00:00Z" : "")) : null);
  const fmtDate = (d, opts = { month: "short", day: "numeric", year: "numeric" }) => {
    const x = parseDate(d);
    return x ? x.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" }) : "—";
  };
  const provName = (p) => (D.models.providers[p] || {}).name || p;
  const model = (id) => D.byId[id];

  const tip = $("tip");
  function showTip(ev, rows) {
    tip.replaceChildren(...rows.map(([cls, t]) => h("div", { class: cls, text: t })));
    tip.hidden = false;
    const pad = 12, r = tip.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function focusTip(el, rows) {
    const b = el.getBoundingClientRect();
    showTip({ clientX: b.right, clientY: b.top }, rows);
  }
  const hideTip = () => (tip.hidden = true);
  function bindTip(el, rows) {
    el.setAttribute("tabindex", "0");
    el.addEventListener("pointermove", (e) => showTip(e, rows));
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("focus", () => focusTip(el, rows));
    el.addEventListener("blur", hideTip);
  }

  // ---------- data ----------
  async function load() {
    const names = ["models", "benchmarks", "incidents", "perception", "news", "trends", "history", "meta"];
    const got = await Promise.all(names.map((n) =>
      fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))));
    D = Object.fromEntries(names.map((n, i) => [n, got[i]]));
    D.history.snapshots = D.history.snapshots || [];
    D.byId = Object.fromEntries(D.models.models.map((m) => [m.id, m]));
    D.scoresBy = {};
    for (const sc of D.benchmarks.scores) (D.scoresBy[sc.model] ||= []).push(sc);
    D.benchById = Object.fromEntries(D.benchmarks.benchmarks.map((b) => [b.id, b]));
    // Entries the pipeline or a reviewer rejected stay in the file (so they're not re-added) but aren't shown.
    D.incidents.incidents = (D.incidents.incidents || []).filter((i) => !i.excluded);
    D.incBy = {};
    D.incByProv = {};
    for (const inc of D.incidents.incidents) {
      for (const m of inc.models || []) (D.incBy[m] ||= []).push(inc);
      (D.incByProv[inc.provider] ||= []).push(inc);
    }
  }

  function series(id, key) {
    return D.history.snapshots
      .map((sn) => ({ date: sn.date, v: (sn.models[id] || {})[key] }))
      .filter((p) => p.v != null);
  }
  function delta(id, key, days = 7) {
    const pts = series(id, key);
    if (pts.length < 2) return null;
    const last = pts[pts.length - 1];
    const cutoff = parseDate(last.date) - days * DAY;
    const base = [...pts].reverse().find((p) => parseDate(p.date) <= cutoff) || pts[0];
    return last.v - base.v;
  }

  // Lab groupings shown alongside the model types in the filter row. A group filters by the lab a
  // model or incident comes from (models.json providers[].group), across all model types.
  const GROUPS = { "eastern-frontier": { label: "Eastern frontier" } };
  const inGroup = (provider) => (D.models.providers[provider] || {}).group === state.cat;
  const inScope = (m, { ignoreOld = false } = {}) =>
    (state.cat === "all" || (GROUPS[state.cat] ? inGroup(m.provider) : m.category === state.cat)) &&
    (!state.prov || m.provider === state.prov) &&
    (ignoreOld || state.showOld || m.status === "active" || m.status === "announced");
  // Incidents carry a lab but no model type, so only the provider filter and lab groups apply.
  const incInScope = (i) => (!state.prov || i.provider === state.prov) && (!GROUPS[state.cat] || inGroup(i.provider));

  // ---------- filters ----------
  function renderFilters() {
    const seg = $("f-cat");
    const opts = [["all", "All models", null], ...Object.entries(CATS).map(([k, c]) => [k, c.label, c.color]),
      ...Object.entries(GROUPS).map(([k, g]) => [k, g.label, null])];
    seg.replaceChildren(...opts.flatMap(([k, label, color]) => {
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(state.cat === k),
        title: GROUPS[k] ? `Models and incidents from ${Object.entries(D.models.providers).filter(([, p]) => p.group === k).map(([, p]) => p.name).join(", ")}` : null,
        onclick: () => { state.cat = k; renderAll(); } },
      color ? h("i", { style: `width:8px;height:8px;border-radius:2px;display:inline-block;background:${color}` }) : null, label);
      // A divider separates the model types from the lab groupings.
      return GROUPS[k] && k === Object.keys(GROUPS)[0] ? [h("span", { class: "seg-sep", "aria-hidden": "true" }), b] : [b];
    }));
    const provSel = $("f-prov");
    if (provSel.options.length === 1) {
      const used = [...new Set(D.models.models.map((m) => m.provider))].sort((a, b) => provName(a).localeCompare(provName(b)));
      for (const p of used) provSel.append(h("option", { value: p, text: provName(p) }));
      provSel.addEventListener("change", () => { state.prov = provSel.value; renderAll(); });
      $("f-old").addEventListener("change", (e) => { state.showOld = e.target.checked; renderAll(); });
    }
  }

  // ---------- KPIs ----------
  function kpi(label, value, detail, isName) {
    return h("div", { class: "kpi" }, h("div", { class: "label", text: label }),
      h("div", { class: "value" + (isName ? " name" : ""), text: value }), h("div", { class: "detail", text: detail }));
  }
  function renderKpis() {
    const ms = D.models.models.filter((m) => inScope(m));
    const withIdx = ms.filter((m) => m.index);
    const lead = withIdx.sort((a, b) => b.index.index - a.index.index)[0];
    const openBest = D.models.models.filter((m) => m.category === "open" && m.index && inScope(m, { ignoreOld: true }))
      .sort((a, b) => b.index.index - a.index.index)[0];
    const lag = (D.trends.indicators || []).find((i) => i.id === "open_weight_lag_months");
    const lagPt = lag && lag.points[lag.points.length - 1];
    const yearAgo = Date.now() - 365 * DAY;
    const breakouts = D.incidents.incidents.filter((i) => i.type === "breakout" && parseDate(i.date) >= yearAgo && incInScope(i));
    const newest = ms.filter((m) => m.released).sort((a, b) => b.released.localeCompare(a.released))[0];
    const dbl = (D.trends.indicators || []).find((i) => i.id === "aisi_doubling_months");
    const dPts = dbl ? dbl.points : [];
    const dLast = dPts[dPts.length - 1], dPrev = dPts[dPts.length - 2];

    $("kpis").replaceChildren(
      kpi("Benchmark leader", lead ? lead.name : "—", lead ? `Index ${lead.index.index} · ${provName(lead.provider)}` : "No benchmarked models in view", true),
      kpi("Best open-weight", openBest ? openBest.name : "—",
        openBest ? `Index ${openBest.index.index} · ${openBest.index.n} benchmark(s)` + (lagPt ? ` · open models ~${lagPt.value} mo behind frontier (CAISI)` : "") : "None in view", true),
      kpi("Containment breakouts, 12 mo", String(breakouts.length),
        breakouts[0] ? `Latest ${fmtDate(breakouts[0].date, { month: "short", day: "numeric" })} · ${provName(breakouts[0].provider)}` : "None disclosed"),
      kpi("Newest model", newest ? newest.name : "—", newest ? `${fmtDate(newest.released)} · ${ms.length} models in view` : "", true),
      kpi("Cyber capability doubling", dLast ? `${dLast.value} mo` : "—",
        dPrev ? `Down from ${dPrev.value} mo (${fmtDate(dPrev.date, { month: "short", year: "numeric" })}) · UK AISI` : ""),
    );
  }

  // ---------- leaderboard ----------
  function barCell(v, max, cls, extra) {
    if (v == null) return h("span", { class: "muted", text: "—" });
    return h("div", { class: "barcell" },
      h("div", { class: "bar " + (cls || "") }, h("span", { style: `width:${Math.max(2, (100 * v) / max)}%` })),
      h("span", { class: "num", text: String(Math.round(v)) }), extra || null);
  }
  function deltaEl(d, invert) {
    if (d == null || Math.abs(d) < 0.5) return null;
    const good = invert ? d < 0 : d > 0;
    return h("span", { class: "delta " + (good ? "up" : "down"), title: "Change over 7 days", text: (d > 0 ? "▲" : "▼") + Math.abs(Math.round(d)) });
  }
  function sparkline(id, key) {
    const pts = series(id, key);
    if (pts.length < 2) return h("span", { class: "muted small", text: pts.length ? "tracking" : "—" });
    const W = 72, H = 20, vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (W - 4) + 2, H - 3 - ((p.v - lo) / span) * (H - 6)]);
    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-label": `${key} trend` });
    svg.append(s("polyline", { points: xy.map((p) => p.join(",")).join(" "), fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const [lx, ly] = xy[xy.length - 1];
    svg.append(s("circle", { cx: lx, cy: ly, r: 2.5, fill: "var(--ink)" }));
    return svg;
  }
  const COLS = [
    { key: "name", label: "Model", get: (m) => m.name.toLowerCase(),
      tip: "Model and the lab that makes it. \u201cauto\u201d marks entries the daily update added that haven't been reviewed yet; \u201csuperseded\u201d means a newer version exists." },
    { key: "category", label: "Type", get: (m) => m.category,
      tip: "GA: generally available to anyone. Gated: restricted to vetted users, usually a cyber-specific variant. Open: weights anyone can download and run." },
    { key: "released", label: "Released", get: (m) => m.released || "", opt: true,
      tip: "First public release, preview or general availability." },
    { key: "index", label: "Benchmark index", get: (m) => (m.index ? m.index.index : -1),
      tip: "0\u2013100. The model's cyber capability benchmark scores, each scaled so the best tracked model scores 100, then averaged and pulled toward 50 when there are few results. Dots show how many benchmarks it has. Developer-reported scores count 0.8\u00d7." },
    { key: "capability", label: "Perceived", get: (m) => perc(m).capability ?? -1,
      tip: "0\u2013100. How capable at cyber the model is seen to be in articles, podcasts, blogs and social posts, re-scored by Claude in the daily update when there is new discussion. The arrow is the change over 7 days." },
    { key: "concern", label: "Concern", get: (m) => perc(m).concern ?? -1,
      tip: "0\u2013100. How much worry about risk or misuse the coverage expresses. The arrow is the change over 7 days; red means concern is rising." },
    { key: "trend", label: "Perceived, trend", get: (m) => delta(m.id, "capability") ?? 0, opt: true,
      tip: "Perceived capability across the daily snapshots; the dot is today. Shows \u201ctracking\u201d until there are two days of data." },
    { key: "buzz", label: "Buzz", get: (m) => perc(m).buzz ?? -1, opt: true,
      tip: "How many items in the latest daily collection mention the model: security news, lab blogs, podcasts, papers, Hacker News and Bluesky." },
    { key: "incidents", label: "Incidents", get: (m) => (D.incBy[m.id] || []).length * 1000 + labIncs(m).length,
      tip: "Incidents involving this model, with the icon showing the worst severity. \u201c+N at lab\u201d counts other incidents at the same lab: its other models, or reports that name no specific model." },
  ];
  const perc = (m) => D.perception.models[m.id] || {};
  // Incidents at the model's lab that are not tied to this model: lab-wide reports and incidents
  // involving the lab's other (often superseded) models. Together with the model's own incidents
  // these add up to that provider's rows in the Breakouts & misuse list.
  const labIncs = (m) => (D.incByProv[m.provider] || []).filter((i) => !(i.models || []).includes(m.id));
  const worstSev = (incs) => incs.map((i) => i.severity).sort((a, b) => Object.keys(SEV).indexOf(a) - Object.keys(SEV).indexOf(b))[0];

  function renderBoard() {
    const ms = D.models.models.filter((m) => inScope(m));
    const col = COLS.find((c) => c.key === state.sort.key);
    ms.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * state.sort.dir || a.name.localeCompare(b.name);
    });
    const thead = h("thead", {}, h("tr", {}, COLS.map((c) => {
      const th = h("th", {
        class: c.opt ? "opt" : null, scope: "col", tabindex: "0", "aria-description": c.tip,
        "aria-sort": state.sort.key === c.key ? (state.sort.dir < 0 ? "descending" : "ascending") : null,
        onclick: () => sortBy(c.key), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), sortBy(c.key)),
      }, h("span", { class: "th-label", text: c.label }));
      bindTip(th, [["tv", c.label], ["tl", c.tip], ["tm", "Click to sort"]]);
      return th;
    })));
    const tbody = h("tbody");
    if (!ms.length) tbody.append(h("tr", {}, h("td", { colspan: COLS.length, class: "muted", text: "No models match these filters." })));
    for (const m of ms) {
      const p = perc(m), incs = D.incBy[m.id] || [], lab = labIncs(m);
      const cat = CATS[m.category];
      const n = m.index ? m.index.n : 0;
      const open = state.open.has(m.id);
      const tr = h("tr", { class: "row", tabindex: "0", "aria-expanded": String(open),
        onclick: () => toggle(m.id), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(m.id)) },
      h("td", {}, h("div", { class: "mname" }, m.name, " ", m.auto_added ? h("span", { class: "auto", title: `Added automatically ${m.auto_added}`, text: "auto" }) : null),
        h("div", { class: "mprov", text: provName(m.provider) + (m.status === "superseded" ? " · superseded" : "") })),
      h("td", {}, h("span", { class: "chip" }, h("i", { style: `background:${cat.color}` }), cat.short)),
      h("td", { class: "opt small", text: m.released ? fmtDate(m.released, { month: "short", year: "numeric" }) : "—" }),
      h("td", {}, barCell(m.index && m.index.index, 100, "idx",
        n ? h("span", { class: "dots", title: `${n} capability benchmark${n > 1 ? "s" : ""}`, text: "●".repeat(Math.min(n, 5)) }) : null)),
      h("td", {}, barCell(p.capability, 100, "", deltaEl(delta(m.id, "capability")))),
      h("td", {}, p.concern == null ? h("span", { class: "muted", text: "—" }) : h("span", {}, h("span", { class: "num", text: String(p.concern) }), " ", deltaEl(delta(m.id, "concern"), true))),
      h("td", { class: "opt" }, sparkline(m.id, "capability")),
      h("td", { class: "opt num", text: p.buzz == null ? "—" : String(p.buzz) }),
      h("td", { class: "inc-cell" },
        incs.length ? h("span", { class: "inc-flag", title: `${incs.length} incident(s) involving this model, worst: ${worstSev(incs)}` },
          statusIcon(worstSev(incs)), String(incs.length)) : h("span", { class: "muted", text: "—" }),
        lab.length ? h("div", { class: "inc-lab", title: `${lab.length} other incident(s) at ${provName(m.provider)}: involving its other models, or no specific model named` },
          `+${lab.length} at lab`) : null),
      );
      tbody.append(tr);
      if (open) tbody.append(detailRow(m));
    }
    $("board").replaceChildren(thead, tbody);
  }
  function sortBy(key) {
    hideTip(); // the header is re-rendered, so drop the tooltip of the old one
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: key === "name" ? 1 : -1 };
    renderBoard();
  }
  function toggle(id) {
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    renderBoard();
  }
  function statusIcon(sev) {
    const v = SEV[sev] || SEV.info;
    return h("span", { class: "ico", style: `background:${v.color};width:14px;height:14px;border-radius:50%;display:inline-grid;place-items:center;font-size:9px;color:#fff;font-weight:700`, "aria-hidden": "true", text: v.icon });
  }
  function detailRow(m) {
    const p = perc(m);
    const scores = (D.scoresBy[m.id] || []).slice().sort((a, b) => (D.benchById[a.benchmark]?.kind || "").localeCompare(D.benchById[b.benchmark]?.kind || ""));
    const left = h("div", {},
      h("h4", { text: "What people are saying" }),
      h("p", { style: "margin:0 0 8px", text: p.summary || "No commentary synthesized yet." }),
      p.tone != null ? h("p", { class: "muted small", style: "margin:0 0 8px", text: `Tone ${p.tone > 0 ? "+" : ""}${p.tone} (−1 to +1)` + (p.updated ? ` · updated ${fmtDate(p.updated)}` : "") }) : null,
      h("h4", { text: "Access" }), h("p", { style: "margin:0 0 8px", text: m.access || "—" }),
      m.category_changed ? h("p", { class: "muted small", style: "margin:0 0 8px" },
        `Reclassified from ${(CATS[m.category_changed.from] || {}).label || m.category_changed.from} to ${(CATS[m.category_changed.to] || {}).label || m.category_changed.to} on ${fmtDate(m.category_changed.date)}: ${m.category_changed.note} · `,
        link("source", m.category_changed.source)) : null,
      m.notes ? h("p", { class: "muted", style: "margin:0 0 8px", text: m.notes }) : null,
      h("h4", { text: "Sources" }),
      h("ul", {}, [...(p.sources || []), ...(m.sources || [])].map((x) => h("li", {}, link(x.title, x.url)))),
    );
    const right = h("div", {},
      h("h4", { text: "Benchmark scores" }),
      scores.length ? h("ul", {}, scores.map((sc) => {
        const b = D.benchById[sc.benchmark] || { name: sc.benchmark };
        return h("li", {}, h("b", { text: `${b.name}: ${sc.value}%` }),
          b.kind === "safeguard" ? h("span", { class: "muted", text: " (safeguard)" }) : null,
          h("span", { class: "muted", text: ` · ${sc.self_reported ? "self-reported" : "independent/third-party"}${sc.note ? " · " + sc.note : ""} · ` }),
          link("source", sc.source), sc.auto ? h("span", { class: "auto", text: "auto" }) : null);
      })) : h("p", { class: "muted", style: "margin:0", text: "No public cyber benchmark scores tracked yet." }),
      incList("Incidents involving this model", D.incBy[m.id] || []),
      incList(`Other ${provName(m.provider)} incidents`, labIncs(m)),
    );
    return h("tr", { class: "detail" }, h("td", { colspan: COLS.length }, h("div", { class: "detail-grid" }, left, right)));
  }

  function incList(title, incs) {
    if (!incs.length) return null;
    return h("div", {}, h("h4", { style: "margin-top:12px", text: title }),
      h("ul", {}, incs.map((i) => h("li", {}, statusIcon(i.severity), ` ${fmtDate(i.date)} — `, link(i.title, (i.sources[0] || {}).url),
        (i.models || []).length ? h("span", { class: "muted", text: ` (${i.models.map((id) => (model(id) || { name: id }).name).join(", ")})` }) : null))));
  }

  // ---------- capability & incidents timeline ----------
  // Label placement shared by the scatter: highest point first, each label scores the spots around
  // its dot (beside it, stepped further up or down, or centred above/below) and takes the one that
  // collides least with labels already placed and with dots, preferring spots close to the dot. A
  // label that had to move gets a leader line back to its dot. The svg must be attached to measure.
  function placeLabels(svg, items, bounds, layer) {
    const boxes = [], LH = 13, GAP = 9;
    const dots = items.map((it) => it);
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const cost = (b, self) => {
      let c = 0;
      for (const o of boxes) c += overlap(b, { x: o.x - 3, y: o.y - 1, w: o.w + 6, h: o.h + 2 }) * 10;
      for (const d of dots) if (d !== self) c += overlap(b, { x: d.x - 8, y: d.y - 8, w: 16, h: 16 }) * 10;
      return c + Math.hypot(b.x + b.w / 2 - self.x, b.y + b.h / 2 - self.y) * 0.3;
    };
    const inside = (b) => b.x >= bounds.l && b.x + b.w <= bounds.r && b.y >= bounds.t && b.y + b.h <= bounds.b;
    for (const it of items.slice().sort((a, b) => a.y - b.y)) {
      const t = s("text", { class: "lbl" }, it.text);
      svg.append(t);
      const w = t.getComputedTextLength(), cands = [];
      for (let k = 0; k <= 7; k++) for (const dy of k ? [-k * LH, k * LH] : [0]) {
        cands.push({ x: it.x + GAP, y: it.y - LH / 2 + dy, w, h: LH, moved: k > 0 });
        cands.push({ x: it.x - GAP - w, y: it.y - LH / 2 + dy, w, h: LH, moved: k > 0 });
      }
      cands.push({ x: it.x - w / 2, y: it.y - 8 - LH, w, h: LH, moved: false }, { x: it.x - w / 2, y: it.y + 8, w, h: LH, moved: false });
      const ok = cands.filter(inside);
      const best = (ok.length ? ok : cands).reduce((a, b) => (cost(b, it) < cost(a, it) ? b : a));
      boxes.push(best);
      t.setAttribute("x", best.x);
      t.setAttribute("y", best.y + LH - 3);
      if (best.moved) {
        const lx = best.x > it.x ? best.x - 2 : best.x + best.w + 2;
        layer.append(s("line", { x1: it.x, y1: it.y, x2: lx, y2: best.y + LH / 2, stroke: "var(--axis)", "stroke-width": 1 }));
      }
    }
  }

  // One mark per incident: shape = type, fill = severity.
  // One mark per incident: shape = type, colour = severity. Hollow = no specific model named.
  function incMark(type, x, y, r, color, hollow) {
    const paint = hollow ? { fill: "var(--surface)", stroke: color, "stroke-width": 1.5 } : { fill: color };
    if (hollow) r -= 0.5; // keep the outlined mark the same visual size as a filled one
    if (type === "misuse") return s("path", { d: `M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}Z`, ...paint });
    if (type === "policy") return s("rect", { x: x - r + 0.5, y: y - r + 0.5, width: 2 * r - 1, height: 2 * r - 1, rx: 1, ...paint });
    return s("circle", { cx: x, cy: y, r, ...paint });
  }

  function renderTimeline() {
    const el = $("timeline");
    const pts = D.models.models.filter((m) => inScope(m, { ignoreOld: true }) && m.released && m.index);
    const incsAll = D.incidents.incidents.filter((i) => incInScope(i) && parseDate(i.date));
    const W = Math.max(300, el.clientWidth), narrow = W < 560;
    const M = { l: 34, r: 16 };
    if (!pts.length && !incsAll.length) {
      const svg = s("svg", { viewBox: `0 0 ${W} 120`, role: "img" });
      svg.append(s("text", { x: W / 2, y: 64, "text-anchor": "middle", class: "empty" }, "Nothing to show for these filters."));
      el.replaceChildren(svg); $("timeline-legend").replaceChildren(); return;
    }
    // Shared time axis: from just before the earliest model release to today. Older incidents are
    // counted at the left edge of the incident lane rather than stretching the axis.
    const ts = pts.map((m) => +parseDate(m.released));
    const start = (ts.length ? Math.min(...ts) : Math.min(...incsAll.map((i) => +parseDate(i.date)))) - 20 * DAY;
    const end = Date.now() + 7 * DAY;
    const earlier = incsAll.filter((i) => +parseDate(i.date) < start);
    const incs = incsAll.filter((i) => +parseDate(i.date) >= start);
    const X = (t) => M.l + ((t - start) / (end - start)) * (W - M.l - M.r);

    // Incident lane: weekly columns, marks stacked upward, most severe at the bottom.
    const R = narrow ? 3 : 4, STEP = 2 * R + 2, WEEK = 7 * DAY, sevOrder = Object.keys(SEV);
    const bins = new Map();
    for (const i of incs) {
      const k = Math.floor((+parseDate(i.date) - start) / WEEK);
      (bins.get(k) || bins.set(k, []).get(k)).push(i);
    }
    for (const b of bins.values()) b.sort((a, z) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(z.severity));
    const maxStack = Math.max(1, ...[...bins.values()].map((b) => b.length));

    const topT = 14, topB = topT + (narrow ? 360 : 290);
    const laneT = topB + 40, laneB = laneT + Math.max(48, maxStack * STEP + 6), H = laneB + 24;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Benchmark index by release date, with incidents by week on the same time axis" });
    const under = s("g"), links = s("g"), over = s("g");

    // Month gridlines run through both lanes so dates line up by eye.
    const d = new Date(start); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const months = Math.round((end - start) / (30 * DAY)), stepM = narrow ? (months > 5 ? 2 : 1) : (months > 10 ? 2 : 1);
    for (; +d <= end; d.setUTCMonth(d.getUTCMonth() + stepM)) {
      under.append(s("line", { x1: X(+d), x2: X(+d), y1: topT, y2: laneB, class: "gridline" }));
      under.append(s("text", { x: X(+d), y: H - 7, "text-anchor": "middle" }, d.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })));
    }

    // Top lane: capability.
    const vs = pts.map((m) => m.index.index);
    const y0 = vs.length ? Math.max(0, Math.floor((Math.min(...vs) - 5) / 10) * 10) : 40;
    const y1 = vs.length ? Math.min(100, Math.ceil((Math.max(...vs) + 5) / 10) * 10) : 90;
    const Y = (v) => topB - ((v - y0) / (y1 - y0)) * (topB - topT);
    for (let v = y0; v <= y1; v += 10) {
      under.append(s("line", { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), class: v === y0 ? "baseline" : "gridline" }));
      under.append(s("text", { x: M.l - 6, y: Y(v) + 4, "text-anchor": "end" }, v));
    }
    under.append(s("text", { x: M.l, y: topT - 4, class: "lane" }, "Benchmark index"));

    // Bottom lane: incidents.
    under.append(s("line", { x1: M.l, x2: W - M.r, y1: laneB, y2: laneB, class: "baseline" }));
    under.append(s("text", { x: M.l, y: laneT - 8, class: "lane" }, narrow
      ? `Incidents by week (${incs.length}${earlier.length ? ` + ${earlier.length} earlier` : ""})`
      : `Incidents (${incs.length}${earlier.length ? `, plus ${earlier.length} earlier` : ""}) · one mark each, by week`));

    svg.append(under, links, over);
    const modelDot = new Map(), incEls = new Map();
    const clearLinks = () => {
      links.replaceChildren();
      svg.querySelectorAll(".hl").forEach((n) => n.classList.remove("hl"));
      svg.classList.remove("focus");
    };

    for (const m of pts.slice().sort((a, b) => a.index.index - b.index.index)) {
      const cx = X(+parseDate(m.released)), cy = Y(m.index.index);
      const mine = D.incBy[m.id] || [];
      const g = s("g", { class: "tl-model", "aria-label": `${m.name}: index ${m.index.index}${mine.length ? `, ${mine.length} incident(s)` : ""}` });
      if (mine.length) g.append(s("circle", { cx, cy, r: 9.5, fill: "none", stroke: "var(--critical)", "stroke-width": 1.5 }));
      g.append(s("circle", { cx, cy, r: 6, fill: CATS[m.category].color, stroke: "var(--surface)", "stroke-width": 2, class: "mark" }));
      const hit = s("circle", { cx, cy, r: 13, class: "hit" });
      g.append(hit);
      bindTip(hit, [["tv", `Index ${m.index.index}`], ["tl", m.name],
        ["tm", `${CATS[m.category].label} · ${fmtDate(m.released)} · ${m.index.n} benchmark(s)${mine.length ? ` · ${mine.length} incident(s)` : ""}`]]);
      const focus = () => {
        clearLinks(); svg.classList.add("focus"); g.classList.add("hl");
        for (const i of mine) {
          const e = incEls.get(i); if (!e) continue;
          e.g.classList.add("hl");
          links.append(s("line", { x1: cx, y1: cy, x2: e.x, y2: e.y, class: "tl-link" }));
        }
      };
      hit.addEventListener("pointerenter", focus); hit.addEventListener("focus", focus);
      hit.addEventListener("pointerleave", clearLinks); hit.addEventListener("blur", clearLinks);
      over.append(g);
      modelDot.set(m.id, { g, x: cx, y: cy });
    }

    for (const [k, b] of bins) {
      const x = X(start + (k + 0.5) * WEEK);
      b.forEach((i, n) => {
        const y = laneB - 3 - R - n * STEP;
        const g = s("g", { class: "tl-inc" });
        const unnamed = !(i.models || []).length;
        g.append(incMark(i.type, x, y, R, (SEV[i.severity] || SEV.info).color, unnamed));
        const hit = s("rect", { x: x - STEP / 2, y: y - STEP / 2, width: STEP, height: STEP, class: "hit" });
        g.append(hit);
        const names = (i.models || []).map((id) => (model(id) || { name: id }).name);
        bindTip(hit, [["tv", i.title], ["tl", `${fmtDate(i.date)} · ${TYPE_LABEL[i.type] || i.type} · ${(SEV[i.severity] || SEV.info).label}`],
          ["tm", `${provName(i.provider)} · ${names.length ? names.join(", ") : "no specific model named"}`]]);
        const focus = () => {
          clearLinks(); svg.classList.add("focus"); g.classList.add("hl");
          for (const id of i.models || []) {
            const md = modelDot.get(id); if (!md) continue;
            md.g.classList.add("hl");
            links.append(s("line", { x1: x, y1: y, x2: md.x, y2: md.y, class: "tl-link" }));
          }
        };
        hit.addEventListener("pointerenter", focus); hit.addEventListener("focus", focus);
        hit.addEventListener("pointerleave", clearLinks); hit.addEventListener("blur", clearLinks);
        over.append(g);
        incEls.set(i, { g, x, y });
      });
    }
    if (earlier.length) {
      over.append(s("text", { x: M.l + 2, y: laneB - 6, class: "lane" }, `← ${earlier.length}`));
    }

    el.replaceChildren(svg); // attached so label widths can be measured
    placeLabels(over, pts.map((m) => ({ x: X(+parseDate(m.released)), y: Y(m.index.index), text: m.name })),
      { l: M.l + 2, r: W - 2, t: topT + 2, b: topB - 2 }, under);

    const types = [...new Set(incs.map((i) => i.type))];
    const swatch = (fn) => { const g = s("svg", { width: 12, height: 12, viewBox: "0 0 12 12" }); g.append(fn()); return g; };
    $("timeline-legend").replaceChildren(
      ...catLegend(pts, true),
      h("span", {}, swatch(() => s("circle", { cx: 6, cy: 6, r: 4.5, fill: "none", stroke: "var(--critical)", "stroke-width": 1.5 })), "Involved in an incident"),
      h("span", { class: "legend-sep" }),
      ...Object.values(SEV).map((v) => h("span", {}, h("i", { style: `background:${v.color}` }), v.label)),
      h("span", { class: "legend-sep" }),
      ...types.map((t) => h("span", {}, swatch(() => incMark(t, 6, 6, 4, "var(--ink-2)")), TYPE_LABEL[t] || t)),
      ...(incs.some((i) => !(i.models || []).length)
        ? [h("span", {}, swatch(() => incMark("breakout", 6, 6, 4, "var(--ink-2)", true)), "No specific model named")] : []),
    );
  }
  function catLegend(items, dot) {
    const present = new Set(items.map((m) => m.category));
    return Object.entries(CATS).filter(([k]) => present.has(k))
      .map(([, c]) => h("span", {}, h("i", { class: dot ? "dot" : "", style: `background:${c.color}` }), c.label));
  }

  // ---------- benchmark explorer ----------
  function renderBenchSelect() {
    const sel = $("bench-sel");
    if (sel.options.length) return;
    const counts = {};
    for (const sc of D.benchmarks.scores) counts[sc.benchmark] = (counts[sc.benchmark] || 0) + 1;
    const bs = D.benchmarks.benchmarks.filter((b) => counts[b.id]).sort((a, b) => (a.kind === b.kind ? counts[b.id] - counts[a.id] : a.kind === "capability" ? -1 : 1));
    for (const b of bs) sel.append(h("option", { value: b.id, text: `${b.name}${b.kind === "safeguard" ? " (safeguard)" : ""} · ${counts[b.id]}` }));
    if (!counts[state.bench] && bs[0]) state.bench = bs[0].id;
    sel.value = state.bench;
    sel.addEventListener("change", () => { state.bench = sel.value; renderBench(); });
  }
  function renderBench() {
    const el = $("bench");
    const b = D.benchById[state.bench];
    $("bench-desc").replaceChildren(b ? h("span", {}, `${b.description} Unit: ${b.unit}${b.higher_is_better ? "" : " (lower is better)"}. `, b.url ? link("About", b.url) : null) : "");
    const rows = D.benchmarks.scores.filter((sc) => sc.benchmark === state.bench && model(sc.model) && inScope(model(sc.model), { ignoreOld: true }))
      .sort((a, b2) => (b.higher_is_better ? b2.value - a.value : a.value - b2.value));
    const LW = Math.min(170, Math.max(110, el.clientWidth * 0.34));
    const W = Math.max(300, el.clientWidth), rowH = 26, M = { t: 4, b: 22 };
    const H = M.t + M.b + Math.max(1, rows.length) * rowH;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${b ? b.name : ""} scores` });
    if (!rows.length) {
      svg.append(s("text", { x: W / 2, y: H / 2 + 4, "text-anchor": "middle", class: "empty" }, "No scores for models in view."));
      el.replaceChildren(svg); return;
    }
    const x0 = LW, x1 = W - 44;
    const X = (v) => x0 + (v / 100) * (x1 - x0);
    for (const v of [0, 25, 50, 75, 100]) {
      svg.append(s("line", { x1: X(v), x2: X(v), y1: M.t, y2: H - M.b, class: v === 0 ? "baseline" : "gridline" }));
      svg.append(s("text", { x: X(v), y: H - 6, "text-anchor": "middle" }, v));
    }
    rows.forEach((sc, i) => {
      const m = model(sc.model), y = M.t + i * rowH, bh = 14, by = y + (rowH - bh) / 2;
      const maxChars = Math.floor((LW - 10) / 6.4);
      const name = m.name.length > maxChars ? m.name.slice(0, maxChars - 1) + "…" : m.name;
      svg.append(s("text", { x: x0 - 8, y: by + 11, "text-anchor": "end", class: "lbl" }, name));
      const w = Math.max(2, X(sc.value) - x0);
      svg.append(s("path", { d: `M${x0},${by} h${w - 4} a4,4 0 0 1 4,4 v${bh - 8} a4,4 0 0 1 -4,4 h${-(w - 4)} z`, fill: CATS[m.category].color, class: "mark" }));
      svg.append(s("text", { x: X(sc.value) + 6, y: by + 11, class: "val" }, sc.value + (sc.self_reported ? "*" : "")));
      const hit = s("rect", { x: 0, y, width: W, height: rowH, class: "hit" });
      bindTip(hit, [["tv", `${sc.value}%`], ["tl", m.name], ["tm", `${sc.self_reported ? "Self-reported by developer" : "Third-party / independent"}${sc.note ? " · " + sc.note : ""} · ${fmtDate(sc.date)}`]]);
      svg.append(hit);
    });
    el.replaceChildren(svg, h("div", { class: "legend" }, ...catLegend(rows.map((r) => model(r.model))), h("span", { class: "muted", text: "* self-reported" })));
  }

  // ---------- incidents ----------
  function renderIncidents() {
    const incs = D.incidents.incidents.filter(incInScope);
    $("incidents").replaceChildren(...(incs.length ? incs.map((i) => {
      const sev = SEV[i.severity] || SEV.info;
      const names = (i.models || []).map((id) => (model(id) || { name: id }).name);
      return h("li", {},
        h("div", { class: "inc-top" },
          h("span", { class: "inc-date", text: fmtDate(i.date) }),
          h("span", { class: "status", style: `color:var(--ink-2)` }, statusIcon(i.severity), `${TYPE_LABEL[i.type] || i.type} · ${sev.label}`),
          h("span", { class: "inc-title", text: i.title }),
          i.auto ? h("span", { class: "auto", text: "auto" }) : null),
        h("p", { class: "inc-sum", text: i.summary }),
        h("p", { class: "inc-src" },
          [provName(i.provider), names.length ? names.join(", ") : "no specific model named"].join(" · ") + " · ",
          ...(i.sources || []).flatMap((x, k) => [k ? ", " : "", link(x.title, x.url)])));
    }) : [h("li", { class: "muted", text: "No incidents for these filters." })]));
  }

  // ---------- takes + news ----------
  function renderRead() {
    const takes = (D.perception.provider_takes || []).filter((t) => (!state.prov || t.provider === state.prov) &&
      (!GROUPS[state.cat] || inGroup(t.provider) || (state.cat === "eastern-frontier" && t.provider === "open")));
    $("takes").replaceChildren(...takes.map((t) => h("div", { class: "take" },
      h("b", { text: t.provider === "open" ? "Open-weight ecosystem" : provName(t.provider) }), h("p", { text: t.take }))));
    const items = (D.news.items || []).filter((n) => {
      if (!state.prov && state.cat === "all") return true;
      return (n.models || []).some((id) => model(id) && inScope(model(id), { ignoreOld: true }));
    }).slice(0, 30);
    $("news").replaceChildren(...(items.length ? items.map((n) => h("li", {},
      h("span", { class: "k", title: n.kind, "aria-label": n.kind, text: KIND_ICON[n.kind] || "•" }),
      h("div", {}, link(n.title, n.url),
        h("div", { class: "m", text: [n.source, fmtDate(n.date), n.kind, (n.models || []).map((id) => (model(id) || {}).name).filter(Boolean).join(", ")].filter(Boolean).join(" · ") })))) :
      [h("li", { class: "muted", text: "No coverage for this filter yet." })]));
  }

  function renderMeta() {
    const m = D.meta || {};
    const when = m.updated || D.models.updated;
    const modeText = { claude: "feeds + Claude analysis", feeds: "feeds only", offline: "recomputed", seed: "seed data" }[m.mode] || "";
    $("updated").textContent = when ? `Updated ${new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${modeText ? " · " + modeText : ""}` : "";
    const days = D.history.snapshots.length;
    $("changes").textContent = (m.changes && m.changes.length ? "Latest run: " + m.changes.slice(0, 6).join(" · ") + ". " : "") +
      `${days} daily snapshot${days === 1 ? "" : "s"} recorded — trend lines fill in as the history grows.`;
  }

  function renderAll() {
    renderFilters();
    renderKpis();
    renderBoard();
    renderTimeline();
    renderBench();
    renderIncidents();
    renderRead();
  }

  // ---------- theme ----------
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("theme"); } catch (_) { /* storage unavailable */ }
    if (saved) document.documentElement.dataset.theme = saved;
    $("theme").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (_) { /* ignore */ }
    });
  }

  initTheme();
  load().then(() => {
    renderMeta();
    renderBenchSelect();
    renderAll();
    let t;
    addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { renderTimeline(); renderBench(); }, 150); });
  }).catch((e) => {
    document.querySelector(".page").append(h("p", { class: "muted", text: "Could not load data: " + e.message }));
  });
})();
