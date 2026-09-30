import { useEffect, useMemo, useRef, useState } from "react";
import { useSchema, useStore, setUi, toast, switchSchema, newSchema, deleteSchema, loadSample, importJson, applyAi, newSchemaFromAi, type Schema } from "../store";
import { generateSchema, type AiResult } from "../lib/ai/client";
import { MAX_PROMPT } from "../lib/ai/schema.mjs";
import { getRf } from "../lib/image";
import { EXPORTERS } from "../lib/export/index.mjs";
import { exportImage, downloadText, type ImgFormat } from "../lib/image";
import { Ic } from "./bits";
import { makeZip } from "../lib/zip";

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: any; wide?: boolean }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><b>{title}</b><button className="ub ub-ghost ub-sm" onClick={onClose} aria-label="Fermer"><Ic name="x" size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Copié dans le presse-papiers"); }
  catch { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); toast("Copié"); } catch { toast("Copie impossible"); } ta.remove(); }
}

function CodeTab() {
  const schema = useSchema();
  const [id, setId] = useState(() => (schema.dialect === "mysql" ? "mysql" : schema.dialect === "sqlite" ? "sqlite" : "postgres"));
  const [fi, setFi] = useState(0);
  const exp = EXPORTERS.find((e: any) => e.id === id) || EXPORTERS[0];
  const out = useMemo(() => { try { return exp.run(schema); } catch (e: any) { return "// Erreur d'export : " + e.message; } }, [schema, exp]);
  const files: { filename: string; content: string }[] = Array.isArray(out) ? out : [{ filename: `${schema.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "schema"}.${exp.ext}`, content: out }];
  const f = files[Math.min(fi, files.length - 1)];
  return (
    <div className="code-tab">
      <div className="exp-list" role="tablist">{EXPORTERS.map((e: any) => <button key={e.id} role="tab" aria-selected={e.id === id} className={"chip" + (e.id === id ? " on" : "")} onClick={() => { setId(e.id); setFi(0); }}>{e.label}</button>)}</div>
      {files.length > 1 && <div className="file-tabs">{files.map((x, i) => <button key={x.filename} className={"ftab" + (i === fi ? " on" : "")} onClick={() => setFi(i)}>{x.filename}</button>)}</div>}
      <pre className="code" tabIndex={0}><code>{f.content}</code></pre>
      <div className="modal-f">
        <span className="dim">{files.length > 1 ? `${files.length} fichiers` : f.filename}</span>
        <div className="row">
          <button className="ub" onClick={() => copy(f.content)}><Ic name="copy" size={15} />Copier{files.length > 1 ? " ce fichier" : ""}</button>
          {files.length > 1 && <button className="ub" onClick={() => copy(files.map((x) => `// ===== ${x.filename} =====\n${x.content}`).join("\n\n"))}><Ic name="copy" size={15} />Tout copier</button>}
          {files.length > 1 && <button className="ub ub-fill" onClick={() => { const u = URL.createObjectURL(makeZip(files)); const a = document.createElement("a"); a.href = u; a.download = `${exp.id}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }}><Ic name="export" size={15} />Télécharger (.zip)</button>}
          {files.length === 1 && <button className="ub ub-fill" onClick={() => { downloadText(f.content, f.filename); }}><Ic name="export" size={15} />Télécharger</button>}
        </div>
      </div>
    </div>
  );
}

function ImageTab() {
  const schema = useSchema();
  const [format, setFormat] = useState<ImgFormat>("png");
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await exportImage({ format, scale, transparent, name: schema.name }); toast("Image exportée"); } catch (e: any) { toast("Échec de l'export : " + (e?.message || "erreur")); } setBusy(false); };
  const fmts: [ImgFormat, string, string][] = [["png", "PNG", "Qualité maximale, fond transparent possible"], ["jpg", "JPG", "Fichier léger"], ["pdf", "PDF", "Une page à la taille du schéma"], ["svg", "SVG", "Vectoriel, pour la retouche"]];
  return (
    <div className="img-tab">
      <div className="fmt-grid">{fmts.map(([k, l, d]) => <button key={k} className={"fmt" + (format === k ? " on" : "")} onClick={() => setFormat(k)} aria-pressed={format === k}><b>{l}</b><span>{d}</span></button>)}</div>
      <div className="opt-row">
        <div className="fld"><span>Résolution</span><div className="seg">{[1, 2, 3].map((s) => <button key={s} className={scale === s ? "on" : ""} onClick={() => setScale(s)} disabled={format === "svg"}>×{s}</button>)}</div></div>
        <label className="chk"><input type="checkbox" checked={transparent} disabled={format !== "png"} onChange={(e) => setTransparent(e.target.checked)} />Fond transparent (PNG)</label>
      </div>
      <div className="modal-f"><span className="dim">Le schéma entier est exporté, quel que soit le zoom.</span><button className="ub ub-fill" disabled={busy} onClick={go}><Ic name="export" size={15} />{busy ? "Export…" : "Exporter l'image"}</button></div>
    </div>
  );
}

export function ExportDialog() {
  const [tab, setTab] = useState<"img" | "code">("code");
  return (
    <Modal title="Exporter" onClose={() => setUi({ dialog: null })} wide>
      <div className="tabs"><button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}><Ic name="code" size={15} />Code &amp; migrations</button><button className={tab === "img" ? "on" : ""} onClick={() => setTab("img")}><Ic name="image" size={15} />Image &amp; PDF</button></div>
      {tab === "code" ? <CodeTab /> : <ImageTab />}
    </Modal>
  );
}

export function SchemasDialog() {
  const schemas = useStore((s) => s.schemas); const activeId = useStore((s) => s.activeId);
  const [txt, setTxt] = useState(""); const [err, setErr] = useState<string | null>(null); const [imp, setImp] = useState(false);
  return (
    <Modal title="Mes schémas" onClose={() => setUi({ dialog: null })}>
      <div className="sch-list">
        {schemas.map((s) => (
          <div key={s.id} className={"sch" + (s.id === activeId ? " on" : "")}>
            <button className="sch-main" onClick={() => switchSchema(s.id)}><b>{s.name || "Sans titre"}</b><span>{s.tables.length} tables · {s.dialect}</span></button>
            <button className="ub ub-ghost ub-sm danger" aria-label="Supprimer" onClick={() => { if (confirm(`Supprimer « ${s.name} » ?`)) deleteSchema(s.id); }}><Ic name="trash" size={15} /></button>
          </div>
        ))}
      </div>
      <div className="modal-f col">
        <div className="row"><button className="ub ub-fill" onClick={() => { newSchema(); }}><Ic name="plus" size={15} />Nouveau schéma</button><button className="ub" onClick={() => loadSample()}>Exemple « Boutique »</button><button className="ub" onClick={() => setImp(!imp)}><Ic name="upload" size={15} />Importer du JSON</button></div>
        {imp && <div className="imp"><textarea value={txt} onChange={(e) => { setTxt(e.target.value); setErr(null); }} placeholder="Colle ici un schéma exporté depuis Trame (format JSON)" rows={6} spellCheck={false} />{err && <p className="hint bad">{err}</p>}<button className="ub ub-fill" disabled={!txt.trim()} onClick={() => { const e = importJson(txt); if (e) setErr(e); else { setTxt(""); setImp(false); } }}>Importer</button></div>}
      </div>
    </Modal>
  );
}

/* ---------- IA ---------- */
const EX_NEW = ["Boutique en ligne : clients, produits, variantes, commandes, paiements et avis", "Blog multi-auteurs avec catégories, tags et commentaires", "Réservation de salles de sport : membres, coachs, cours, créneaux", "SaaS multi-organisation : membres, rôles, invitations, abonnements"];
const EX_EDIT = ["Ajoute des avis produits notés de 1 à 5", "Ajoute la gestion des adresses de livraison", "Ajoute un soft delete (deleted_at) partout", "Traduis les commentaires de table en anglais"];
const exLabel = (x: string) => x.split(/ :| avec| \(| notés/)[0];
const draft = { new: "", edit: "" };

export function AiDialog() {
  const schema = useSchema();
  const hasTables = schema.tables.length > 0;
  const [mode, setMode] = useState<"new" | "edit">("new");
  const [text, setText] = useState(draft.new);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<AiResult | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const close = () => { draft[mode] = text; setUi({ dialog: null }); };
  const switchMode = (m: "new" | "edit") => { if (busy) ctrl.current?.abort(); draft[mode] = text; setMode(m); setText(draft[m]); setRes(null); setErr(null); };

  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(null); setRes(null);
    ctrl.current = new AbortController();
    try { setRes(await generateSchema(text.trim(), schema.dialect, mode === "edit" ? schema : null, ctrl.current.signal)); }
    catch (e: any) { if (e?.name !== "AbortError") setErr(e?.message || "Erreur"); }
    setBusy(false);
  };
  const apply = (how: "replace" | "merge" | "edit" | "newSchema") => {
    if (!res) return;
    draft[mode] = "";
    if (how === "newSchema") newSchemaFromAi(res.schema); else applyAi(res.schema, how);
    toast(how === "newSchema" ? "Nouveau schéma créé" : "Schéma mis à jour — Ctrl+Z pour annuler");
    setTimeout(() => getRf()?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }), 80);
  };

  const g = res?.schema as Schema | undefined;
  const rels = g ? g.tables.reduce((n, t) => n + t.columns.filter((c) => c.ref).length, 0) : 0;
  const names = new Map((g?.tables ?? []).map((t) => [t.id, t.name]));

  return (
    <Modal title="Générer avec l'IA" onClose={close} wide>
      {hasTables && <div className="tabs"><button className={mode === "new" ? "on" : ""} onClick={() => switchMode("new")}><Ic name="spark" size={15} />Décrire un projet</button><button className={mode === "edit" ? "on" : ""} onClick={() => switchMode("edit")}><Ic name="table" size={15} />Modifier ce schéma</button></div>}
      <div className="ai-body">
        <label className="fld">
          <span>{mode === "new" ? "Décris ton application : entités, qui fait quoi, règles importantes" : `Que faut-il changer dans « ${schema.name || "ce schéma"} » ?`}</span>
          <textarea className="ai-in" value={text} maxLength={MAX_PROMPT} rows={4} autoFocus disabled={busy}
            placeholder={mode === "new" ? "Ex. une plateforme de cours en ligne : formateurs, élèves, cours découpés en leçons, inscriptions payantes, progression…" : "Ex. ajoute des coupons de réduction applicables aux commandes"}
            onChange={(e) => { setText(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } }} />
        </label>
        <div className="ai-meta">
          <div className="ai-ex">{(mode === "new" ? EX_NEW : EX_EDIT).map((x) => <button key={x} className="chip" disabled={busy} title={x} onClick={() => { setText(x); setErr(null); }}>{exLabel(x)}</button>)}</div>
          <small className="dim">{text.length}/{MAX_PROMPT}</small>
        </div>
        {err && <p className="hint bad ai-err" role="alert">{err}</p>}
        {busy && <div className="ai-wait" role="status"><span className="spin" />Conception du schéma… (10 à 40 s)</div>}
        {g && !busy && (
          <div className="ai-prev">
            <div className="ai-sum"><b>{g.name}</b><span className="dim">{g.tables.length} tables · {rels} relations · {schema.dialect}</span></div>
            {res!.warnings.length > 0 && <ul className="ai-warn">{res!.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <div className="ai-grid">
              {g.tables.map((t) => (
                <div key={t.id} className="ai-card" style={{ ["--tc" as any]: t.color }}>
                  <div className="ai-card-h"><i /><b>{t.name}</b><small>{t.columns.length}</small></div>
                  <ul>{t.columns.map((c) => <li key={c.id}><span className={c.pk ? "pk" : ""}>{c.name}</span><em>{c.ref ? "→ " + (names.get(c.ref.table) || "?") : c.type}</em></li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="modal-f">
        <span className="dim">{g && !busy ? "Tout reste modifiable ensuite." : "Ctrl+Entrée pour générer"}</span>
        <div className="row">
          {busy && <button className="ub ub-ghost" onClick={() => ctrl.current?.abort()}>Arrêter</button>}
          {(!g || busy) && <button className="ub ub-fill" disabled={busy || !text.trim()} onClick={go}><Ic name="spark" size={15} />{busy ? "Génération…" : "Générer"}</button>}
          {g && !busy && <>
            <button className="ub ub-ghost" onClick={go}>Régénérer</button>
            {mode === "edit" && <button className="ub ub-fill" onClick={() => apply("edit")}><Ic name="check" size={15} />Appliquer</button>}
            {mode === "new" && !hasTables && <button className="ub ub-fill" onClick={() => apply("replace")}><Ic name="check" size={15} />Utiliser ce schéma</button>}
            {mode === "new" && hasTables && <>
              <button className="ub" onClick={() => apply("newSchema")}>Nouveau schéma</button>
              <button className="ub" onClick={() => apply("replace")}>Remplacer</button>
              <button className="ub ub-fill" onClick={() => apply("merge")}><Ic name="plus" size={15} />Ajouter au schéma</button>
            </>}
          </>}
        </div>
      </div>
    </Modal>
  );
}
