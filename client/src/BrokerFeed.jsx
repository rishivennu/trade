import { useState, useEffect } from "react";
import { api } from "./api.js";
import { Radio, AlertTriangle, CheckCircle2, ExternalLink, Plug, Unplug } from "lucide-react";

// Deliberately blunt about its own status. A greyed-out honest panel is more
// useful than a green one that lies, because the whole point of this app is
// that you can trust the numbers it shows you.
export default function BrokerFeed() {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("zerodha");
  const [tokens, setTokens] = useState("");

  const load = async () => {
    try { setSt(await api.brokerStatus()); setErr(null); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      setSt(await api.brokerConnect({
        provider,
        tokens: tokens.split(/[,\s]+/).filter(Boolean).map(Number).filter(n => !isNaN(n)),
      }));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const disconnect = async () => { await api.brokerDisconnect(); load(); };

  if (!st) return <div className="card"><div className="card-h">Live Tick Feed</div><div className="dim">{err || "Loading…"}</div></div>;

  const conn = st.connection;
  const sel = st.providers.find(p => p.key === provider);

  return (
    <div className="card">
      <div className="card-h"><Radio size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> Broker Tick Feed</div>

      <div className="wf-verdict bad" style={{ marginBottom: 14 }}>
        <AlertTriangle size={18} aria-hidden="true" />
        <div>
          <div className="wf-v-title">Unverified scaffold — not receiving ticks</div>
          <div className="wf-v-sub">{st.warning}</div>
          <div className="wf-v-sub" style={{ marginTop: 6 }}>{st.fallback}</div>
        </div>
      </div>

      <div className="bk-list" role="radiogroup" aria-label="Broker tick-feed provider">
        {st.providers.map(p => (
          <div key={p.key} className={`bk-prov ${p.key === provider ? "on" : ""}`}
            onClick={() => setProvider(p.key)}>
            <div className="bk-p-head">
              {p.configured ? <CheckCircle2 size={13} aria-hidden="true" className="green" /> : <AlertTriangle size={13} aria-hidden="true" className="dim" />}
              <label className="bk-p-name" htmlFor={`bk-${p.key}`}>
                <input className="bk-radio" type="radio" name="bk-provider" id={`bk-${p.key}`}
                  checked={p.key === provider} onChange={() => setProvider(p.key)} />
                {p.label}
              </label>
              <a className="bk-p-doc" href={p.docs} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                docs <ExternalLink size={10} aria-hidden="true" />
              </a>
            </div>
            <div className="bk-p-row">{p.subscription}</div>
            <div className="bk-p-row dim">{p.tokenLife}</div>
            <div className="bk-p-row">
              {p.configured
                ? <span className="green">credentials present</span>
                : <>needs {p.missingEnv.map((v, i) => <span key={v}>{i > 0 ? " + " : ""}<code>{v}</code></span>)} in <code>server/.env</code></>}
              {!p.parserImplemented && <span className="red"> · tick decoder not implemented</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="fwd-create" style={{ marginTop: 14 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="brokerfeed-instrument-tokens-span-classname-fhint-s-own-numeric-ids-comma-separated-not-yahoo-symbols-span-1">Instrument tokens <span className="fhint">{sel?.label}'s own numeric IDs, comma separated — not Yahoo symbols</span></label>
          <input id="brokerfeed-instrument-tokens-span-classname-fhint-s-own-numeric-ids-comma-separated-not-yahoo-symbols-span-1" className="input" value={tokens} onChange={e => setTokens(e.target.value)} placeholder="408065, 738561" />
        </div>
        <button className="btn btn-primary" onClick={connect} disabled={busy || !sel?.configured}>
          <Plug size={14} />{busy ? "Connecting…" : "Connect"}
        </button>
        <button className="btn" onClick={disconnect}><Unplug size={14} /> Disconnect</button>
      </div>

      {err && <div className="err-box" role="alert" style={{ marginTop: 12 }}><AlertTriangle size={14} aria-hidden="true" /> {err}</div>}

      <div className="rm-grid" style={{ marginTop: 14 }}>
        <div className="rm-cell"><div className="rm-lbl">Status</div><div className="rm-val" style={{ fontSize: 14 }}>{conn.status}</div></div>
        <div className="rm-cell"><div className="rm-lbl">Provider</div><div className="rm-val" style={{ fontSize: 14 }}>{conn.provider || "—"}</div></div>
        <div className="rm-cell"><div className="rm-lbl">Ticks received</div><div className="rm-val" style={{ fontSize: 14 }}>{conn.tickCount}</div></div>
        <div className="rm-cell"><div className="rm-lbl">Subscribed</div><div className="rm-val" style={{ fontSize: 14 }}>{conn.subscribed}</div></div>
      </div>
      {conn.error && <div className="warn-line">{conn.error}</div>}
    </div>
  );
}
