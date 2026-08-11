// Pine Script v5 SUBSET compiler + streaming interpreter.
// Lexer -> Pratt parser -> per-bar interpreter that emits BUY/SELL/FLAT signals.
// Supports: input.*, ta.* (sma/ema/rma/wma/rsi/atr/tr/stdev/highest/lowest/change/
//   mom/roc/crossover/crossunder/cross/macd/cci/sma), math.*, nz/na, series history [n],
//   var persistence, :=, ternary, and/or/not, strategy.entry/close/exit/long/short.
// NOT supported (throws): cross-symbol request.security, line/label/box/table, for/while, user funcs, switch.
// request.security() IS supported for higher timeframes on the chart symbol (real resampling).

const NA = NaN;
const isNA = (v) => v == null || (typeof v === "number" && Number.isNaN(v));

// ---------- Lexer ----------
const KEYWORDS = new Set(["and", "or", "not", "if", "else", "for", "while", "var", "varip", "true", "false", "na", "to", "by", "switch"]);
function lex(src) {
  const toks = [];
  const rawLines = src.split(/\r?\n/);
  // strip // comments (respect strings) per physical line
  const stripped = rawLines.map((s0) => {
    let inStr = false, q = "", clean = "";
    for (let i = 0; i < s0.length; i++) {
      const c = s0[i];
      if (inStr) { clean += c; if (c === q) inStr = false; continue; }
      if (c === '"' || c === "'") { inStr = true; q = c; clean += c; continue; }
      if (c === "/" && s0[i + 1] === "/") break;
      clean += c;
    }
    return clean;
  });
  // join continuation lines: open brackets, or trailing / leading continuation operators
  const contStart = /^\s*(and\b|or\b|\?|:|\)|\]|,|\+|\*|\/|%|==|!=|>=|<=|>|<|\.)/;
  const contEnd = /(:=|=|\band\b|\bor\b|\bnot\b|\+|-|\*|\/|%|\?|:|,|==|!=|>=|<=|>|<|\.|\(|\[)\s*$/;
  const logical = [];
  let depth = 0;
  for (let ln = 0; ln < stripped.length; ln++) {
    const raw = stripped[ln];
    if (!raw.trim() && depth <= 0) continue;
    const prev = logical.length ? logical[logical.length - 1] : null;
    const prevTrim = prev ? prev.text.replace(/\s+$/, "") : "";
    const join = prev && (depth > 0 || contEnd.test(prevTrim) || (raw.trim() && contStart.test(raw)));
    if (join) prev.text += " " + raw.trim();
    else logical.push({ text: raw, line: ln + 1, indent: raw.match(/^\s*/)[0].replace(/\t/g, "    ").length });
    depth += (raw.match(/[([]/g) || []).length - (raw.match(/[)\]]/g) || []).length;
    if (depth < 0) depth = 0;
  }
  for (let li = 0; li < logical.length; li++) {
    const s = logical[li].text;
    const indent = logical[li].indent;
    const lineNo = logical[li].line;
    if (!s.trim()) continue;
    toks.push({ t: "NL", indent, line: lineNo });
    let i = 0;
    const push = (t, v) => toks.push({ t, v, line: lineNo });
    while (i < s.length) {
      const c = s[i];
      if (c === " " || c === "\t") { i++; continue; }
      if (c === '"' || c === "'") {
        const qc = c; let j = i + 1, str = "";
        while (j < s.length && s[j] !== qc) { str += s[j]; j++; }
        push("STR", str); i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1]))) {
        let j = i, num = "";
        while (j < s.length && /[0-9._eE]/.test(s[j]) && !(s[j] === "." && s[j + 1] === ".")) { if (s[j] !== "_") num += s[j]; j++; }
        push("NUM", parseFloat(num)); i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i, id = "";
        while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) { id += s[j]; j++; }
        // dotted namespace: ta.ema, math.max, strategy.entry, input.int, color.red
        while (s[j] === "." && /[A-Za-z_]/.test(s[j + 1])) {
          id += "."; j++;
          while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) { id += s[j]; j++; }
        }
        if (KEYWORDS.has(id)) push("KW", id); else push("ID", id);
        i = j; continue;
      }
      // operators (multi-char first)
      const three = s.substr(i, 3), two = s.substr(i, 2);
      if (two === ":=" ) { push("OP", ":="); i += 2; continue; }
      if (["==", "!=", ">=", "<=", "=>"].includes(two)) { push("OP", two); i += 2; continue; }
      if ("+-*/%<>=?:()[],".includes(c)) { push("OP", c); i++; continue; }
      throw pineErr(`Unexpected character '${c}'`, lineNo);
    }
  }
  toks.push({ t: "NL", indent: 0, line: rawLines.length });
  toks.push({ t: "EOF", line: rawLines.length });
  return toks;
}

function pineErr(msg, line) { const e = new Error(`Pine error${line ? ` (line ${line})` : ""}: ${msg}`); e.pine = true; return e; }

// ---------- Parser (Pratt) ----------
const UNSUPPORTED = ["array.", "matrix."];
function parse(src) {
  const toks = lex(src);
  let p = 0;
  const PREC = { "or": 1, "and": 2, "==": 3, "!=": 3, ">": 4, ">=": 4, "<": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
  const peek = (k = 0) => toks[p + k];
  const at = (t, v) => peek().t === t && (v === undefined || peek().v === v);
  const eat = (t, v) => { if (!at(t, v)) throw pineErr(`expected ${v || t} but got '${peek().v ?? peek().t}'`, peek().line); return toks[p++]; };
  const opt = (t, v) => { if (at(t, v)) { return toks[p++]; } return null; };
  const skipNL = () => { while (at("NL")) p++; };

  const inputs = [];
  const stmts = [];
  const meta = { kind: "strategy", title: "" };

  skipNL();
  while (!at("EOF")) {
    skipNL();
    if (at("EOF")) break;
    const st = parseStatement(0);
    if (st) stmts.push(st);
  }
  // capture strategy()/indicator() title + kind for labeling
  for (const st of stmts) {
    if (st.k === "exprstmt" && st.expr.k === "call" && (st.expr.name === "strategy" || st.expr.name === "indicator")) {
      meta.kind = st.expr.name;
      const a0 = st.expr.args[0];
      if (a0 && a0.k === "str") meta.title = a0.v;
      break;
    }
  }
  return { stmts, inputs, meta };

  function curIndent() { // indent of the NL token just before current
    for (let k = p - 1; k >= 0; k--) { if (toks[k].t === "NL") return toks[k].indent; }
    return 0;
  }

  function parseStatement(minIndent) {
    skipNL();
    const tk = peek();
    // version / declaration lines we ignore: strategy(...) / indicator(...) / plot* / etc handled as expr-stmt then discarded
    if (at("KW", "if")) return parseIf(curIndent());
    if (at("KW", "for") || at("KW", "while") || at("KW", "switch"))
      throw pineErr(`'${tk.v}' loops/switch are not supported in this engine`, tk.line);
    // var / varip declaration
    let isVar = false;
    if (at("KW", "var") || at("KW", "varip")) { isVar = true; p++; }
    // typed decl: e.g. "float x = na" / "int len = 14" -> skip leading type id if followed by ID then '='/':='
    if (at("ID") && ["int","float","bool","string","color","line","label","table","box","array","map","matrix"].includes(peek().v) && peek(1).t === "ID") {
      p++; // drop type keyword
    }
    // tuple assignment: [a, b, c] = expr
    if (at("OP", "[")) {
      const save = p;
      p++; const names = [];
      let ok = true;
      while (!at("OP", "]")) {
        if (!at("ID")) { ok = false; break; }
        names.push(eat("ID").v);
        if (!opt("OP", ",")) break;
      }
      if (ok && at("OP", "]") && peek(1).t === "OP" && (peek(1).v === "=" || peek(1).v === ":=")) {
        eat("OP", "]"); const op = eat("OP").v; const rhs = parseExpr(0);
        return { k: "tuple", names, rhs, decl: true };
      }
      p = save; // not a tuple assign, rewind
    }
    if (at("ID") && (peek(1).t === "OP") && (peek(1).v === "=" || peek(1).v === ":=")) {
      const name = eat("ID").v; const op = eat("OP").v; const rhs = parseExpr(0);
      return { k: "assign", name, rhs, isVar, reassign: op === ":=" };
    }
    // otherwise expression statement (calls like strategy.entry, plot, alertcondition)
    const ex = parseExpr(0);
    return { k: "exprstmt", expr: ex };
  }

  function parseIf(ifIndent) {
    eat("KW", "if"); const cond = parseExpr(0); skipNL();
    const body = parseBlock(ifIndent);
    let elseBody = null, elifNode = null;
    skipNL();
    if (at("KW", "else")) {
      const eIndent = curIndent();
      if (eIndent >= ifIndent) {
        p++; // else
        if (at("KW", "if")) { elifNode = parseIf(ifIndent); }
        else { skipNL(); elseBody = parseBlock(ifIndent); }
      }
    }
    return { k: "if", cond, body, elseBody, elifNode };
  }

  function parseBlock(parentIndent) {
    skipNL();
    const bodyIndent = curIndent();
    const out = [];
    if (bodyIndent <= parentIndent) { // single-line block was on same line (rare) -> parse one stmt
      return out;
    }
    while (!at("EOF")) {
      skipNL();
      if (at("EOF")) break;
      const ind = curIndent();
      if (ind < bodyIndent) break;
      out.push(parseStatement(bodyIndent));
    }
    return out;
  }

  // Pratt expression parser
  function parseExpr(rbp) {
    let left = nud();
    for (;;) {
      const tk = peek();
      let opv = null;
      if (tk.t === "OP" && PREC[tk.v]) opv = tk.v;
      else if (tk.t === "KW" && (tk.v === "and" || tk.v === "or")) opv = tk.v;
      else if (tk.t === "OP" && tk.v === "?") {
        if (rbp >= 1) break;
        p++; const then = parseExpr(0); eat("OP", ":"); const els = parseExpr(0);
        left = { k: "ternary", cond: left, then, els }; continue;
      }
      if (!opv) break;
      const lbp = PREC[opv];
      if (lbp <= rbp) break;
      p++;
      const right = parseExpr(lbp);
      left = { k: "bin", op: opv, l: left, r: right };
    }
    return left;
  }

  function nud() {
    const tk = peek();
    if (tk.t === "NUM") { p++; return { k: "num", v: tk.v }; }
    if (tk.t === "STR") { p++; return { k: "str", v: tk.v }; }
    if (tk.t === "KW" && (tk.v === "true" || tk.v === "false")) { p++; return { k: "bool", v: tk.v === "true" }; }
    if (tk.t === "KW" && tk.v === "na") { p++; if (at("OP", "(")) return postfix(parseCall("na")); return { k: "na" }; }
    if (tk.t === "KW" && tk.v === "not") { p++; return { k: "not", e: parseExpr(2.5) }; }
    if (tk.t === "OP" && tk.v === "-") { p++; return { k: "neg", e: parseExpr(6.5) }; }
    if (tk.t === "OP" && tk.v === "+") { p++; return parseExpr(6.5); }
    if (tk.t === "OP" && tk.v === "(") { p++; const e = parseExpr(0); eat("OP", ")"); return postfix(e); }
    if (tk.t === "ID") {
      const name = tk.v;
      for (const u of UNSUPPORTED) if (name === u || name.startsWith(u)) throw pineErr(`'${name}' is not supported in this engine`, tk.line);
      p++;
      let node;
      if (at("OP", "(")) node = parseCall(name);
      else node = { k: "id", name };
      return postfix(node);
    }
    throw pineErr(`unexpected '${tk.v ?? tk.t}'`, tk.line);
  }

  function postfix(node) {
    // history indexing e[n]
    while (at("OP", "[")) { p++; const idx = parseExpr(0); eat("OP", "]"); node = { k: "hist", e: node, idx }; }
    return node;
  }

  function parseCall(name) {
    eat("OP", "(");
    const args = []; const kwargs = {};
    while (!at("OP", ")")) {
      if (at("ID") && peek(1).t === "OP" && peek(1).v === "=") {
        const kn = eat("ID").v; eat("OP", "="); kwargs[kn] = parseExpr(0);
      } else {
        args.push(parseExpr(0));
      }
      if (!opt("OP", ",")) break;
    }
    eat("OP", ")");
    return { k: "call", name, args, kwargs };
  }
}

// ---------- Streaming runtime helpers (stateful, keyed by call site) ----------
function makeTA() {
  return {
    // ema state.prev
    ema(st, x, len) { if (isNA(x)) return NA; const a = 2 / (len + 1); st.p = isNA(st.p) ? x : a * x + (1 - a) * st.p; return st.p; },
    rma(st, x, len) { if (isNA(x)) return NA; const a = 1 / len;
      if (isNA(st.p)) { st.buf = st.buf || []; st.buf.push(x); if (st.buf.length < len) return NA; st.p = st.buf.reduce((s, v) => s + v, 0) / len; return st.p; }
      st.p = a * x + (1 - a) * st.p; return st.p; },
    sma(st, x, len) { st.buf = st.buf || []; st.buf.push(x); if (st.buf.length > len) st.buf.shift(); if (st.buf.length < len) return NA; return st.buf.reduce((s, v) => s + v, 0) / len; },
    wma(st, x, len) { st.buf = st.buf || []; st.buf.push(x); if (st.buf.length > len) st.buf.shift(); if (st.buf.length < len) return NA; let w = 0, d = 0; for (let i = 0; i < len; i++) { const k = i + 1; w += st.buf[i] * k; d += k; } return w / d; },
    stdev(st, x, len) { st.buf = st.buf || []; st.buf.push(x); if (st.buf.length > len) st.buf.shift(); if (st.buf.length < len) return NA; const m = st.buf.reduce((s, v) => s + v, 0) / len; const va = st.buf.reduce((s, v) => s + (v - m) ** 2, 0) / len; return Math.sqrt(va); },
    highest(st, x, len) { st.buf = st.buf || []; st.buf.push(x); if (st.buf.length > len) st.buf.shift(); if (st.buf.length < len) return NA; return Math.max(...st.buf); },
    lowest(st, x, len) { st.buf = st.buf || []; st.buf.push(x); if (st.buf.length > len) st.buf.shift(); if (st.buf.length < len) return NA; return Math.min(...st.buf); },
    change(st, x, n) { st.buf = st.buf || []; st.buf.push(x); const need = (n || 1) + 1; if (st.buf.length > need) st.buf.shift(); if (st.buf.length < need) return NA; return x - st.buf[0]; },
    cross(st, a, b, dir) { const pa = st.pa, pb = st.pb; st.pa = a; st.pb = b; if (isNA(pa) || isNA(pb)) return false;
      if (dir === "over") return pa <= pb && a > b; if (dir === "under") return pa >= pb && a < b; return (pa <= pb && a > b) || (pa >= pb && a < b); },
    pivothigh(st, x, left, right) { st.buf = st.buf || []; st.buf.push(x); const need = left + right + 1; if (st.buf.length > need) st.buf.shift(); if (st.buf.length < need) return NA; const cand = st.buf[left]; if (isNA(cand)) return NA; for (let j = 0; j < st.buf.length; j++) { if (j !== left && !(st.buf[j] < cand)) return NA; } return cand; },
    pivotlow(st, x, left, right) { st.buf = st.buf || []; st.buf.push(x); const need = left + right + 1; if (st.buf.length > need) st.buf.shift(); if (st.buf.length < need) return NA; const cand = st.buf[left]; if (isNA(cand)) return NA; for (let j = 0; j < st.buf.length; j++) { if (j !== left && !(st.buf[j] > cand)) return NA; } return cand; },
  };
}

// ---------- Compile & Run ----------
export function compilePine(src) {
  const ast = parse(src);
  return {
    meta: ast.meta,
    run(candles, overrides = {}) {
      const ta = makeTA();
      const state = new Map(); // callsite node -> streaming state
      const stOf = (node) => { let s = state.get(node); if (!s) { s = {}; state.set(node, s); } return s; };

      // `n` and `builtinSeries` are mutable so request.security() can temporarily
      // swap the whole evaluation context onto a resampled higher-timeframe series.
      let n = candles.length;
      const mkSeries = (cs) => ({
        open: cs.map(c => c.open), high: cs.map(c => c.high), low: cs.map(c => c.low),
        close: cs.map(c => c.close), volume: cs.map(c => c.volume ?? 0),
        hl2: cs.map(c => (c.high + c.low) / 2),
        hlc3: cs.map(c => (c.high + c.low + c.close) / 3),
        ohlc4: cs.map(c => (c.open + c.high + c.low + c.close) / 4),
      });
      const baseSeries = mkSeries(candles);
      let builtinSeries = baseSeries;

      const longEntry = new Array(n).fill(false), shortEntry = new Array(n).fill(false), flat = new Array(n).fill(false);
      const exitLevels = new Array(n).fill(null);   // per-bar strategy.exit() stop/limit declarations
      const securityCalls = [];                    // resampled HTFs actually requested
      const inputMeta = [];

      // per-variable history so x[k] works
      const hist = Object.create(null);
      const cur = Object.create(null);     // current-bar scalar value per var
      const varInit = new Set();           // `var` vars already initialized
      let i = 0;

      function getHist(name, k) {
        if (name in builtinSeries) { const idx = i - k; return idx >= 0 ? builtinSeries[name][idx] : NA; }
        if (name === "bar_index") return i - k;
        if (k === 0 && name in cur) return cur[name];
        // hist[name] holds bars 0..i-1 (pushed at end of each bar), so bar (i-k) is at idx (length-k)
        const h = hist[name]; if (!h) return NA; const idx = h.length - k; return idx >= 0 && idx < h.length ? h[idx] : NA;
      }

      function evalNode(node) {
        switch (node.k) {
          case "num": return node.v;
          case "str": return node.v;
          case "bool": return node.v;
          case "na": return NA;
          case "neg": { const v = evalNode(node.e); return isNA(v) ? NA : -v; }
          case "not": return !truthy(evalNode(node.e));
          case "id": {
            const nm = node.name;
            if (nm in builtinSeries) return builtinSeries[nm][i];
            if (nm in cur) return cur[nm];
            if (nm === "bar_index") return i;
            if (nm === "strategy.long") return "long";
            if (nm === "strategy.short") return "short";
            if (nm === "strategy.position_size") return posSize;
            if (nm === "barstate.islast" || nm === "barstate.islastconfirmedhistory") return i === n - 1;
            if (nm === "barstate.isfirst") return i === 0;
            if (nm === "barstate.isnew") return true;
            if (nm === "barstate.isconfirmed" || nm === "barstate.ishistory") return true;
            if (nm === "barstate.isrealtime") return false;
            if (nm === "syminfo.mintick") return 0.01;
            if (nm === "syminfo.pointvalue") return 1;
            if (nm === "syminfo.tickerid" || nm === "syminfo.ticker" || nm === "syminfo.prefix" || nm === "syminfo.currency") return "";
            if (nm === "timeframe.period") return "";
            // enum-ish namespaces resolve to their own name so kwargs can test them
            if (nm.startsWith("barmerge.") || nm.startsWith("color.") || nm.startsWith("shape.") ||
                nm.startsWith("location.") || nm.startsWith("size.") || nm.startsWith("extend.") ||
                nm.startsWith("display.") || nm.startsWith("format.") || nm.startsWith("scale.") ||
                nm.startsWith("alert.") || nm.startsWith("plot.") || nm.startsWith("position.") ||
                nm.startsWith("text.") || nm.startsWith("xloc.") || nm.startsWith("yloc.") ||
                nm.startsWith("line.style_") || nm.startsWith("label.style_") || nm.startsWith("font.") ||
                nm.startsWith("currency.") || nm.startsWith("session.") || nm.startsWith("adjustment.") ||
                nm.startsWith("strategy.commission.")) return nm;
            if (nm === "math.pi") return Math.PI;
            if (nm === "math.e") return Math.E;
            if (nm === "math.phi") return 1.618033988749895;
            if (nm === "math.rphi") return 0.618033988749895;
            if (nm.startsWith("timeframe.")) return false;
            if (nm in cur) return cur[nm];
            return NA;
          }
          case "hist": {
            let k = evalNode(node.idx); k = isNA(k) ? 0 : Math.round(k);
            if (node.e.k === "id") return getHist(node.e.name, k);
            // history on complex expr: only bar-0 supported
            return k === 0 ? evalNode(node.e) : NA;
          }
          case "ternary": return truthy(evalNode(node.cond)) ? evalNode(node.then) : evalNode(node.els);
          case "bin": return binop(node.op, node.l, node.r);
          case "call": return callFn(node);
          case "tuplecall": return callFn(node);
          default: return NA;
        }
      }
      function truthy(v) { if (typeof v === "boolean") return v; if (isNA(v)) return false; return !!v; }
      function binop(op, ln, rn) {
        if (op === "and") return truthy(evalNode(ln)) && truthy(evalNode(rn));
        if (op === "or") return truthy(evalNode(ln)) || truthy(evalNode(rn));
        const a = evalNode(ln), b = evalNode(rn);
        if (op === "==") return a === b; if (op === "!=") return a !== b;
        if (isNA(a) || isNA(b)) { return ["<",">","<=",">="].includes(op) ? false : NA; }
        switch (op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "%": return a % b;
          case ">": return a > b; case "<": return a < b; case ">=": return a >= b; case "<=": return a <= b; }
        return NA;
      }

      function argval(node, kwargs, keys, pos, def) {
        for (const key of keys) if (kwargs && key in kwargs) return evalNode(kwargs[key]);
        if (pos < node.args.length) return evalNode(node.args[pos]);
        return def;
      }
      function rawArg(node, kwargs, keys, pos) {
        for (const key of keys) if (kwargs && key in kwargs) return kwargs[key];
        return pos < node.args.length ? node.args[pos] : null;
      }

      function callFn(node) {
        const nm = node.name, A = node.args, K = node.kwargs, st = stOf(node);
        const v0 = () => evalNode(A[0]);
        // inputs
        if (nm.startsWith("input")) {
          const def = A.length ? evalNode(A[0]) : NA;
          const title = argval(node, K, ["title"], 1, "");
          if (!st.reg) { st.reg = true; inputMeta.push({ name: title || nm, type: nm.split(".")[1] || "any", def }); }
          const ov = title && title in overrides ? overrides[title] : undefined;
          return ov !== undefined ? ov : def;
        }
        // math.*
        if (nm === "math.abs") return Math.abs(v0());
        if (nm === "math.max") return Math.max(...A.map(evalNode));
        if (nm === "math.min") return Math.min(...A.map(evalNode));
        if (nm === "math.pow") return Math.pow(evalNode(A[0]), evalNode(A[1]));
        if (nm === "math.sqrt") return Math.sqrt(v0());
        if (nm === "math.round") return Math.round(v0());
        if (nm === "math.floor") return Math.floor(v0());
        if (nm === "math.ceil") return Math.ceil(v0());
        if (nm === "math.avg") { const xs = A.map(evalNode); return xs.reduce((s, x) => s + x, 0) / xs.length; }
        if (nm === "math.sign") { const x = v0(); return isNA(x) ? NA : Math.sign(x); }
        if (nm === "nz") { const x = v0(); return isNA(x) ? (A.length > 1 ? evalNode(A[1]) : 0) : x; }
        if (nm === "na") return isNA(v0());
        // ta.* streaming
        if (nm === "ta.sma") return ta.sma(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.ema") return ta.ema(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.rma") return ta.rma(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.wma") return ta.wma(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.stdev") return ta.stdev(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.highest") return ta.highest(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.lowest") return ta.lowest(st, evalNode(A[0]), evalNode(A[1]));
        if (nm === "ta.change") return ta.change(st, evalNode(A[0]), A[1] ? evalNode(A[1]) : 1);
        if (nm === "ta.mom") return ta.change(st, evalNode(A[0]), A[1] ? evalNode(A[1]) : 1);
        if (nm === "ta.roc") { const c = ta.change(st, evalNode(A[0]), A[1] ? evalNode(A[1]) : 1); const ref = getHistArg(A[0], st); return isNA(c) || isNA(ref) || ref === 0 ? NA : (c / ref) * 100; }
        if (nm === "ta.tr") { const pc = i > 0 ? builtinSeries.close[i - 1] : NA; if (isNA(pc)) return builtinSeries.high[i] - builtinSeries.low[i]; return Math.max(builtinSeries.high[i] - builtinSeries.low[i], Math.abs(builtinSeries.high[i] - pc), Math.abs(builtinSeries.low[i] - pc)); }
        if (nm === "ta.atr") { const len = evalNode(A[0]); const pc = i > 0 ? builtinSeries.close[i - 1] : NA; const tr = isNA(pc) ? builtinSeries.high[i] - builtinSeries.low[i] : Math.max(builtinSeries.high[i] - builtinSeries.low[i], Math.abs(builtinSeries.high[i] - pc), Math.abs(builtinSeries.low[i] - pc)); return ta.rma(st, tr, len); }
        if (nm === "ta.rsi") {
          const srcNode = A[0], len = evalNode(A[1]); const x = evalNode(srcNode);
          const prev = getHistArg(srcNode, st, true);
          st._prev = st._prev ?? { p: x };
          const ch = isNA(st.lastSrc) ? 0 : x - st.lastSrc; st.lastSrc = x;
          const gain = ch > 0 ? ch : 0, loss = ch < 0 ? -ch : 0;
          st.g = st.g || {}; st.l = st.l || {};
          const ag = ta.rma(st.g, gain, len), al = ta.rma(st.l, loss, len);
          if (isNA(ag) || isNA(al)) return NA; if (al === 0) return 100; const rs = ag / al; return 100 - 100 / (1 + rs);
        }
        if (nm === "ta.crossover") return ta.cross(st, evalNode(A[0]), evalNode(A[1]), "over");
        if (nm === "ta.crossunder") return ta.cross(st, evalNode(A[0]), evalNode(A[1]), "under");
        if (nm === "ta.cross") return ta.cross(st, evalNode(A[0]), evalNode(A[1]), "any");
        if (nm === "ta.cci") {
          const src = evalNode(A[0]), len = evalNode(A[1]);
          const ma = ta.sma(st, src, len); if (isNA(ma)) return NA;
          st.dbuf = st.dbuf || []; st.dbuf.push(src); if (st.dbuf.length > len) st.dbuf.shift();
          const md = st.dbuf.reduce((s, v) => s + Math.abs(v - ma), 0) / st.dbuf.length;
          return md === 0 ? 0 : (src - ma) / (0.015 * md);
        }
        if (nm === "ta.vwap") { const tp = (builtinSeries.high[i] + builtinSeries.low[i] + builtinSeries.close[i]) / 3; st.pv = (st.pv || 0) + tp * builtinSeries.volume[i]; st.vv = (st.vv || 0) + builtinSeries.volume[i]; return st.vv ? st.pv / st.vv : NA; }
        if (nm === "ta.macd") { // returns [macd, signal, hist]
          const src = evalNode(A[0]), f = evalNode(A[1]), sl = evalNode(A[2]), sg = evalNode(A[3]);
          st.ef = st.ef || {}; st.es = st.es || {}; st.sig = st.sig || {};
          const ef = ta.ema(st.ef, src, f), es = ta.ema(st.es, src, sl);
          const macd = (isNA(ef) || isNA(es)) ? NA : ef - es; const sig = ta.ema(st.sig, macd, sg);
          return [macd, sig, isNA(macd) || isNA(sig) ? NA : macd - sig];
        }
        if (nm === "ta.pivothigh" || nm === "ta.pivotlow") {
          let src, left, right;
          if (A.length >= 3) { src = evalNode(A[0]); left = Math.round(evalNode(A[1])); right = Math.round(evalNode(A[2])); }
          else { src = nm === "ta.pivothigh" ? builtinSeries.high[i] : builtinSeries.low[i]; left = Math.round(evalNode(A[0])); right = Math.round(evalNode(A[1])); }
          return nm === "ta.pivothigh" ? ta.pivothigh(st, src, left, right) : ta.pivotlow(st, src, left, right);
        }
        if (nm === "ta.dmi") {
          const diLen = evalNode(A[0]), adxLen = evalNode(A[1]);
          const pc = i > 0 ? builtinSeries.close[i - 1] : NA;
          const tr = isNA(pc) ? builtinSeries.high[i] - builtinSeries.low[i] : Math.max(builtinSeries.high[i] - builtinSeries.low[i], Math.abs(builtinSeries.high[i] - pc), Math.abs(builtinSeries.low[i] - pc));
          const up = i > 0 ? builtinSeries.high[i] - builtinSeries.high[i - 1] : NA, down = i > 0 ? builtinSeries.low[i - 1] - builtinSeries.low[i] : NA;
          const plusDM = (!isNA(up) && up > down && up > 0) ? up : 0;
          const minusDM = (!isNA(down) && down > up && down > 0) ? down : 0;
          st._tr = st._tr || {}; st._p = st._p || {}; st._m = st._m || {}; st._adx = st._adx || {};
          const trur = ta.rma(st._tr, tr, diLen), pr = ta.rma(st._p, plusDM, diLen), mr = ta.rma(st._m, minusDM, diLen);
          const plus = (isNA(trur) || trur === 0) ? NA : 100 * pr / trur;
          const minus = (isNA(trur) || trur === 0) ? NA : 100 * mr / trur;
          const sum = (isNA(plus) || isNA(minus)) ? NA : plus + minus;
          const dx = isNA(sum) ? NA : Math.abs(plus - minus) / (sum === 0 ? 1 : sum);
          const adx = 100 * ta.rma(st._adx, isNA(dx) ? 0 : dx, adxLen);
          return [plus, minus, adx];
        }
        if (nm === "ta.barssince") { const cnd = truthy(evalNode(A[0])); if (cnd) st.c = 0; else if (st.c != null) st.c++; return st.c == null ? NA : st.c; }
        if (nm === "ta.cum") { const x = evalNode(A[0]); st.s = (st.s || 0) + (isNA(x) ? 0 : x); return st.s; }
        if (nm === "ta.valuewhen") { const cnd = truthy(evalNode(A[0])), val = evalNode(A[1]); st.vw = st.vw || []; if (cnd) st.vw.unshift(val); const occ = A[2] ? Math.round(evalNode(A[2])) : 0; return st.vw.length > occ ? st.vw[occ] : NA; }
        if (nm === "fixnan") { const x = v0(); if (!isNA(x)) st.last = x; return st.last == null ? NA : st.last; }
        // strategy.*
        if (nm === "strategy.entry") {
          const dir = argval(node, K, ["direction"], 1, "long");
          const when = "when" in K ? truthy(evalNode(K.when)) : true;
          if (when) { if (dir === "short") shortEntry[i] = true; else longEntry[i] = true; }
          return NA;
        }
        if (nm === "strategy.close" || nm === "strategy.close_all") {
          const when = "when" in K ? truthy(evalNode(K.when)) : true;
          if (when) flat[i] = true; return NA;
        }
        if (nm === "strategy.exit") {
          const when = "when" in K ? truthy(evalNode(K.when)) : true;
          if (!when) return NA;
          // Register the protective levels so the engine can test them against
          // later bars. Previously this flattened the position on the spot,
          // which exited at the wrong price and ignored stop/limit entirely.
          const num = (k) => { if (!(k in K)) return null; const v = evalNode(K[k]); return isNA(v) ? null : v; };
          const stop = num("stop"), limit = num("limit"), loss = num("loss"), profit = num("profit");
          const trail = num("trail_points"), trailOffset = num("trail_offset");
          if (stop == null && limit == null && loss == null && profit == null && trail == null) {
            flat[i] = true;            // a bare strategy.exit() really is a market exit
            return NA;
          }
          exitLevels[i] = { stop, limit, loss, profit, trail, trailOffset };
          return NA;
        }
        // declarations / plotting -> ignore
        if (["strategy", "indicator", "plot", "plotshape", "plotchar", "plotcandle", "plotarrow", "hline", "fill", "bgcolor", "barcolor", "alertcondition", "alert"].includes(nm)) return NA;
        if (nm.startsWith("color.")) return nm;
        if (nm === "request.security" || nm === "security") return htfSecurity(node, A, K, st);
        if (nm.startsWith("str.")) return "";
        if (nm === "time" || nm === "time_close" || nm === "timestamp") return i + 1; // non-na so session filters pass
        if (nm.startsWith("table.") || nm.startsWith("label.") || nm.startsWith("line.") || nm.startsWith("box.")) return NA;
        for (const u of UNSUPPORTED) if (nm.startsWith(u)) throw pineErr(`'${nm}' is not supported`, 0);
        // unknown call -> ignore gracefully returning na
        return NA;
      }
      // ---- request.security(): real higher-timeframe resampling ----------------
      // Pine timeframe strings: "5"/"60"/"240" = minutes, "1S" = seconds,
      // "D"/"2D" = days, "W" = weeks, "M" = months.
      function tfSeconds(tf) {
        const t = String(tf ?? "").trim().toUpperCase();
        if (!t) return null;
        const m = t.match(/^(\d*)\s*([SDWM]?)$/);
        if (!m) return null;
        const mult = m[1] ? parseInt(m[1], 10) : 1;
        if (!mult || mult < 1) return null;
        switch (m[2]) {
          case "": return mult * 60;
          case "S": return mult;
          case "D": return mult * 86400;
          case "W": return mult * 7 * 86400;
          case "M": return mult * 30 * 86400;
          default: return null;
        }
      }

      function htfSecurity(node, A, K, st) {
        if (A.length < 3) throw pineErr("request.security() needs (symbol, timeframe, expression)", node.line || 0);
        if (!st.ready) {
          const sym = evalNode(A[0]);
          if (typeof sym === "string" && sym.trim() !== "") {
            throw pineErr(
              `request.security() can only reference the chart symbol here (got "${sym}"). ` +
              `Use syminfo.tickerid or "" — cross-symbol requests are not available in this engine.`,
              node.line || 0);
          }
          const tfRaw = evalNode(A[1]);
          const secs = tfSeconds(tfRaw);
          if (!secs) throw pineErr(`request.security(): unrecognised timeframe "${tfRaw}"`, node.line || 0);

          // lookahead=barmerge.lookahead_on reads the still-forming HTF bar. That
          // is genuine look-ahead bias; off (the default) waits for bar close.
          let lookahead = false;
          if (K && K.lookahead) {
            const lv = evalNode(K.lookahead);
            lookahead = typeof lv === "string" && /lookahead_on/i.test(lv);
          }

          // Bucket LTF bars into HTF bars.
          const bucketOf = (t) => Math.floor(t / secs);
          const htf = [];
          const bucketIds = [];
          let curB = null, agg = null;
          const perBarBucket = new Array(n);
          for (let k = 0; k < n; k++) {
            const c = candles[k], b = bucketOf(c.time);
            perBarBucket[k] = b;
            if (b !== curB) {
              if (agg) { htf.push(agg); bucketIds.push(curB); }
              curB = b;
              agg = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
            } else {
              agg.high = Math.max(agg.high, c.high);
              agg.low = Math.min(agg.low, c.low);
              agg.close = c.close;
              agg.volume += c.volume ?? 0;
            }
          }
          if (agg) { htf.push(agg); bucketIds.push(curB); }

          // For each LTF bar, which HTF bar's value is legitimately known?
          // lookahead off -> the last FULLY CLOSED htf bar (bucket strictly earlier).
          // lookahead on  -> the htf bar this ltf bar belongs to (forming).
          // bucketIds is ascending and LTF bars are chronological, so a single
          // forward cursor is enough.
          const mapIdx = new Array(n).fill(-1);
          {
            let own = 0;
            for (let k = 0; k < n; k++) {
              while (own + 1 < bucketIds.length && bucketIds[own] !== perBarBucket[k]) own++;
              mapIdx[k] = lookahead ? own : own - 1;
            }
          }

          // Evaluate the expression once per HTF bar, streaming, with the whole
          // context swapped. ta.* state inside belongs to these nodes only, so it
          // never mixes with the chart-timeframe pass.
          const saveI = i, saveSeries = builtinSeries, saveN = n;
          const out = new Array(htf.length).fill(NA);
          try {
            builtinSeries = mkSeries(htf);
            n = htf.length;
            for (let j = 0; j < htf.length; j++) { i = j; out[j] = evalNode(A[2]); }
          } finally {
            i = saveI; builtinSeries = saveSeries; n = saveN;
          }

          st.values = new Array(saveN).fill(NA);
          for (let k = 0; k < saveN; k++) {
            const mi = mapIdx[k];
            st.values[k] = mi >= 0 && mi < out.length ? out[mi] : NA;
          }
          st.ready = true;
          st.info = { timeframe: String(tfRaw), seconds: secs, htfBars: htf.length, lookahead };
          if (!securityCalls.some(x => x.timeframe === st.info.timeframe)) securityCalls.push(st.info);
        }
        return st.values[i] ?? NA;
      }

      function getHistArg(srcNode, st, one) { // previous value of a source node for roc/rsi (approx via id history)
        if (srcNode.k === "id") return getHist(srcNode.name, 1);
        return NA;
      }

      let posSize = 0;
      function execStmt(s) {
        switch (s.k) {
          case "assign": {
            if (s.isVar && s.reassign === false && varInit.has(s.name)) {
              // var already initialized: keep persisting current value (do not re-init)
              return;
            }
            const v = evalNode(s.rhs);
            cur[s.name] = v;
            if (s.isVar) varInit.add(s.name);
            return;
          }
          case "tuple": {
            const v = evalNode(s.rhs);
            const arr = Array.isArray(v) ? v : [v];
            s.names.forEach((nm, idx) => { cur[nm] = arr[idx]; });
            return;
          }
          case "exprstmt": evalNode(s.expr); return;
          case "if": {
            if (truthy(evalNode(s.cond))) s.body.forEach(execStmt);
            else if (s.elifNode) execStmt(s.elifNode);
            else if (s.elseBody) s.elseBody.forEach(execStmt);
            return;
          }
        }
      }

      for (i = 0; i < n; i++) {
        // reset per-bar recomputed vars (var vars persist via varInit/cur)
        for (const st of ast.stmts) execStmt(st);
        // push history for all current vars
        for (const nm in cur) { (hist[nm] || (hist[nm] = [])).push(cur[nm]); }
        // update crude position size for strategy.position_size
        if (longEntry[i]) posSize = 1; else if (shortEntry[i]) posSize = -1; else if (flat[i]) posSize = 0;
      }

      // If no strategy.* calls fired, map indicator buy/sell signal vars to entries
      let usedStrategy = longEntry.some(Boolean) || shortEntry.some(Boolean) || flat.some(Boolean) || exitLevels.some(Boolean);
      if (!usedStrategy) {
        const buyName = ["buySignal", "longCondition", "longSignal", "long", "buy", "goLong"].find((k) => k in hist);
        const sellName = ["sellSignal", "shortCondition", "shortSignal", "short", "sell", "goShort"].find((k) => k in hist);
        if (buyName || sellName) {
          const bh = buyName ? hist[buyName] : null, sh = sellName ? hist[sellName] : null;
          const boff = bh ? n - bh.length : 0, soff = sh ? n - sh.length : 0;
          for (let k = 0; k < n; k++) {
            if (bh && k - boff >= 0 && truthy(bh[k - boff])) longEntry[k] = true;
            if (sh && k - soff >= 0 && truthy(sh[k - soff])) shortEntry[k] = true;
          }
          usedStrategy = longEntry.some(Boolean) || shortEntry.some(Boolean);
        }
      }
      // build combined per-bar signal
      const signals = new Array(n).fill("NEUTRAL");
      for (let k = 0; k < n; k++) {
        if (longEntry[k]) signals[k] = "BUY";
        else if (shortEntry[k]) signals[k] = "SELL";
        else if (flat[k]) signals[k] = "FLAT";
      }
      const hasStrategy = usedStrategy;
      return { signals, longEntry, shortEntry, flat, exitLevels, inputs: inputMeta, hasStrategy, securityCalls };
    },
  };
}
