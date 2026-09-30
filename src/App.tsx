import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useSchema, useStore, setUi, mutate, undo, redo, canUndo, canRedo, addTable, autoLayout, toggleTheme, applyTheme } from "./store";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { ExportDialog, SchemasDialog, AiDialog } from "./components/Dialogs";
import { aiAvailable } from "./lib/ai/client";
import { Ic, Mark } from "./components/bits";
import { getRf, viewCenter } from "./lib/image";

function Top() {
  const schema = useSchema(); const theme = useStore((s) => s.theme);
  useStore((s) => s.schemas); // rafraîchit l'état undo/redo
  const [ai, setAi] = useState(false);
  useEffect(() => { aiAvailable().then(setAi); }, []);
  return (
    <header className="top">
      <div className="brand"><Mark /><span>Trame</span><small>v0.1</small></div>
      <button className="pname" onClick={() => setUi({ dialog: "schemas" })} title="Mes schémas"><Ic name="folder" size={15} /><span>{schema.name || "Sans titre"}</span><em>{schema.dialect}</em></button>
      <div className="tools">
        <button className="ub ub-fill" onClick={() => { const c = viewCenter(); addTable(c?.x, c?.y); }}><Ic name="plus" size={15} /><span className="lbl">Table</span></button>
        <span className="sep" />
        <button className="ub ub-ghost ub-ico" disabled={!canUndo()} onClick={undo} title="Annuler (Ctrl+Z)" aria-label="Annuler"><Ic name="undo" /></button>
        <button className="ub ub-ghost ub-ico" disabled={!canRedo()} onClick={redo} title="Refaire (Ctrl+Maj+Z)" aria-label="Refaire"><Ic name="redo" /></button>
        <button className="ub ub-ghost ub-ico" onClick={() => { autoLayout(); setTimeout(() => getRf()?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }), 60); }} title="Ranger automatiquement" aria-label="Ranger"><Ic name="layout" /></button>
        <button className="ub ub-ghost ub-ico" onClick={() => getRf()?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 })} title="Tout voir" aria-label="Tout voir"><Ic name="fit" /></button>
      </div>
      <div className="right">
        <button className="ub" aria-label="IA" disabled={!ai} onClick={() => setUi({ dialog: "ai" })} title={ai ? "Générer ou modifier le schéma en le décrivant" : "IA indisponible : serveur absent ou GROQ_API_KEY non configurée"}><Ic name="spark" size={15} /><span className="lbl">IA</span></button>
        <button className="ub soon" disabled title="Étape suivante : édition à plusieurs en temps réel"><Ic name="users" size={15} />Partager<em>bientôt</em></button>
        <button className="ub ub-ghost ub-ico" onClick={toggleTheme} aria-label="Changer de thème" title="Thème">{theme === "dark" ? <Ic name="sun" /> : <Ic name="moon" />}</button>
        <button className="ub ub-solid" onClick={() => setUi({ dialog: "export" })}><Ic name="export" size={15} /><span className="lbl">Exporter</span></button>
      </div>
    </header>
  );
}

function Tables() {
  const schema = useSchema(); const sel = useStore((s) => s.selTable);
  return (
    <aside className="list" aria-label="Tables">
      <div className="list-h"><span>Tables</span><button className="ub ub-sm ub-ghost" onClick={() => { const c = viewCenter(); addTable(c?.x, c?.y); }} aria-label="Ajouter une table"><Ic name="plus" size={14} /></button></div>
      <div className="list-s">
        {schema.tables.map((t) => (
          <button key={t.id} className={"li" + (sel === t.id ? " on" : "")} onClick={() => { setUi({ selTable: t.id, selCol: null }); getRf()?.setCenter(t.x + 132, t.y + 90, { zoom: 1, duration: 300 }); }}>
            <i style={{ background: t.color }} /><span>{t.name}</span><small>{t.columns.length}</small>
          </button>
        ))}
        {!schema.tables.length && <p className="empty">Aucune table. Clique sur « Table » ou double-clique sur le canevas.</p>}
      </div>
    </aside>
  );
}

export default function App() {
  return <ReactFlowProvider><Shell /></ReactFlowProvider>;
}
function Shell() {
  const dialog = useStore((s) => s.dialog); const toastMsg = useStore((s) => s.toast);
  useEffect(() => { applyTheme(); }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, []);
  return (
    <div className="app">
      <Top />
      <Tables />
      <main className="stage"><Canvas /></main>
      <Inspector />
      {dialog === "export" && <ExportDialog />}
      {dialog === "schemas" && <SchemasDialog />}
      {dialog === "ai" && <AiDialog />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
