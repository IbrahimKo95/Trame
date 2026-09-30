import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useSchema, useStore, setUi, mutate, updateTable, deleteTable, duplicateTable, addColumn, updateColumn, deleteColumn, moveColumn, setRef, addIndex, updateIndex, deleteIndex, COLORS, type Column, type Table } from "../store";
import { TYPES, ACTIONS } from "../lib/export/types.mjs";
import { Ic } from "./bits";

const Field = ({ label, children, wide }: { label: string; children: any; wide?: boolean }) => (<label className={"fld" + (wide ? " wide" : "")}><span>{label}</span>{children}</label>);

function ColumnEditor({ t, c, i, n }: { t: Table; c: Column; i: number; n: number }) {
  const schema = useSchema();
  const open = useStore((s) => s.selCol === c.id);
  const up = (p: Partial<Column>) => updateColumn(t.id, c.id, p);
  const meta = TYPES.find((x: any) => x.id === c.type);
  const refT = c.ref ? schema.tables.find((x) => x.id === c.ref!.table) : null;
  const Flag = ({ k, label, title }: { k: "pk" | "nullable" | "unique"; label: string; title: string }) => (
    <button type="button" className={"flag" + (c[k] ? " on" : "")} title={title} aria-pressed={!!c[k]} onClick={(e) => { e.stopPropagation(); up({ [k]: !c[k] } as any); }}>{label}</button>
  );
  return (
    <div className={"col" + (open ? " open" : "")}>
      <div className="col-line" onClick={() => setUi({ selCol: open ? null : c.id })}>
        <input className="col-name" value={c.name} onClick={(e) => e.stopPropagation()} onChange={(e) => up({ name: e.target.value })} aria-label="Nom de la colonne" spellCheck={false} />
        <select className="col-type" value={c.type} onClick={(e) => e.stopPropagation()} onChange={(e) => up({ type: e.target.value })} aria-label="Type">
          {TYPES.map((x: any) => <option key={x.id} value={x.id}>{x.id}</option>)}
        </select>
        <Flag k="pk" label="PK" title="Clé primaire" /><Flag k="nullable" label="N" title="Nullable (accepte NULL)" /><Flag k="unique" label="U" title="Valeur unique" />
      </div>
      {open && (
        <div className="col-more">
          <div className="grid2">
            <Field label="Valeur par défaut"><input value={c.default} placeholder="ex. now(), 0, 'actif'" onChange={(e) => up({ default: e.target.value })} spellCheck={false} /></Field>
            {meta?.hasLength && <Field label="Longueur"><input type="number" min={1} value={c.length ?? 255} onChange={(e) => up({ length: Number(e.target.value) || 255 })} /></Field>}
            {meta?.hasPrecision && <><Field label="Précision"><input type="number" min={1} value={c.precision ?? 10} onChange={(e) => up({ precision: Number(e.target.value) || 10 })} /></Field><Field label="Décimales"><input type="number" min={0} value={c.scale ?? 2} onChange={(e) => up({ scale: Number(e.target.value) || 0 })} /></Field></>}
            {c.type === "enum" && <Field label="Valeurs (séparées par des virgules)" wide><input value={(c.enumValues || []).join(", ")} onChange={(e) => up({ enumValues: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>}
            <Field label="Commentaire" wide><input value={c.comment} onChange={(e) => up({ comment: e.target.value })} /></Field>
          </div>
          {["integer", "bigInteger", "smallInteger"].includes(c.type) && <label className="chk"><input type="checkbox" checked={c.autoIncrement} onChange={(e) => up({ autoIncrement: e.target.checked })} />Auto-incrément</label>}
          <div className="refbox">
            <div className="refbox-h"><Ic name="link" size={13} />Clé étrangère</div>
            <div className="grid2">
              <Field label="Table">
                <select value={c.ref?.table || ""} onChange={(e) => { const tb = schema.tables.find((x) => x.id === e.target.value); if (!tb) return setRef(t.id, c.id, null); const pk = tb.columns.find((k) => k.pk) || tb.columns[0]; setRef(t.id, c.id, { table: tb.id, column: pk.id, onDelete: c.ref?.onDelete || "no action", onUpdate: c.ref?.onUpdate || "no action" }); }}>
                  <option value="">Aucune</option>{schema.tables.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              {c.ref && <Field label="Colonne"><select value={c.ref.column} onChange={(e) => setRef(t.id, c.id, { ...c.ref!, column: e.target.value })}>{(refT?.columns || []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>}
              {c.ref && <><Field label="ON DELETE"><select value={c.ref.onDelete} onChange={(e) => setRef(t.id, c.id, { ...c.ref!, onDelete: e.target.value })}>{ACTIONS.map((a: string) => <option key={a}>{a}</option>)}</select></Field>
                <Field label="ON UPDATE"><select value={c.ref.onUpdate} onChange={(e) => setRef(t.id, c.id, { ...c.ref!, onUpdate: e.target.value })}>{ACTIONS.map((a: string) => <option key={a}>{a}</option>)}</select></Field></>}
            </div>
          </div>
          <div className="col-actions">
            <button className="ub ub-sm ub-ghost" disabled={i === 0} onClick={() => moveColumn(t.id, c.id, -1)}><Ic name="up" size={14} />Monter</button>
            <button className="ub ub-sm ub-ghost" disabled={i === n - 1} onClick={() => moveColumn(t.id, c.id, 1)}><Ic name="down" size={14} />Descendre</button>
            <button className="ub ub-sm ub-ghost danger" onClick={() => deleteColumn(t.id, c.id)}><Ic name="trash" size={14} />Supprimer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TableInspector({ t }: { t: Table }) {
  const schema = useSchema();
  const rf = useReactFlow();
  const dupName = schema.tables.some((x) => x.id !== t.id && x.name === t.name);
  const [idxCols, setIdxCols] = useState<string[]>([]);
  return (
    <div className="insp-body">
      <div className="insp-head">
        <span className="insp-kicker">Table</span>
        <div className="insp-tools">
          <button className="ub ub-sm ub-ghost" title="Centrer sur la table" onClick={() => rf.setCenter(t.x + 132, t.y + 80, { zoom: 1, duration: 300 })}><Ic name="fit" size={14} /></button>
          <button className="ub ub-sm ub-ghost" title="Dupliquer" onClick={() => duplicateTable(t.id)}><Ic name="copy" size={14} /></button>
          <button className="ub ub-sm ub-ghost danger" title="Supprimer la table" onClick={() => deleteTable(t.id)}><Ic name="trash" size={14} /></button>
        </div>
      </div>
      <Field label="Nom"><input className={dupName ? "bad" : ""} value={t.name} onChange={(e) => updateTable(t.id, { name: e.target.value })} spellCheck={false} /></Field>
      {dupName && <p className="hint bad">Une autre table porte déjà ce nom.</p>}
      <div className="swatches" role="radiogroup" aria-label="Couleur">
        {COLORS.map((c) => <button key={c} role="radio" aria-checked={t.color === c} className={"sw" + (t.color === c ? " on" : "")} style={{ background: c }} onClick={() => updateTable(t.id, { color: c })} aria-label={c} />)}
      </div>
      <Field label="Commentaire"><input value={t.comment} onChange={(e) => updateTable(t.id, { comment: e.target.value })} /></Field>

      <div className="sec-h"><span>Colonnes <em>{t.columns.length}</em></span><button className="ub ub-sm" onClick={() => addColumn(t.id)}><Ic name="plus" size={14} />Ajouter</button></div>
      <div className="cols">{t.columns.map((c, i) => <ColumnEditor key={c.id} t={t} c={c} i={i} n={t.columns.length} />)}</div>

      <div className="sec-h"><span>Index <em>{t.indexes.length}</em></span></div>
      {t.indexes.map((ix) => (
        <div key={ix.id} className="idx">
          <div className="idx-l"><input value={ix.name} onChange={(e) => updateIndex(t.id, ix.id, { name: e.target.value })} spellCheck={false} /><button className="ub ub-sm ub-ghost danger" onClick={() => deleteIndex(t.id, ix.id)} aria-label="Supprimer l'index"><Ic name="x" size={14} /></button></div>
          <div className="chips">{t.columns.map((c) => { const on = ix.columns.includes(c.id); return <button key={c.id} className={"chip" + (on ? " on" : "")} onClick={() => { const cols = on ? ix.columns.filter((x) => x !== c.id) : [...ix.columns, c.id]; if (cols.length) updateIndex(t.id, ix.id, { columns: cols }); }}>{c.name}</button>; })}</div>
          <label className="chk"><input type="checkbox" checked={ix.unique} onChange={(e) => updateIndex(t.id, ix.id, { unique: e.target.checked })} />Unique</label>
        </div>
      ))}
      <div className="idx-new">
        <div className="chips">{t.columns.map((c) => { const on = idxCols.includes(c.id); return <button key={c.id} className={"chip" + (on ? " on" : "")} onClick={() => setIdxCols(on ? idxCols.filter((x) => x !== c.id) : [...idxCols, c.id])}>{c.name}</button>; })}</div>
        <button className="ub ub-sm" disabled={!idxCols.length} onClick={() => { addIndex(t.id, idxCols); setIdxCols([]); }}><Ic name="plus" size={14} />Créer un index</button>
      </div>
    </div>
  );
}

export function Inspector() {
  const schema = useSchema();
  const sel = useStore((s) => s.selTable);
  const t = schema.tables.find((x) => x.id === sel);
  const nRel = schema.tables.reduce((n, x) => n + x.columns.filter((c) => c.ref).length, 0);
  return (
    <aside className="insp" aria-label="Propriétés">
      {t ? <TableInspector t={t} /> : (
        <div className="insp-body">
          <div className="insp-head"><span className="insp-kicker">Schéma</span></div>
          <Field label="Nom du schéma"><input value={schema.name} onChange={(e) => mutate((s) => { s.name = e.target.value; }, false)} /></Field>
          <Field label="Base de données cible">
            <select value={schema.dialect} onChange={(e) => mutate((s) => { s.dialect = e.target.value as any; })}>
              <option value="postgres">PostgreSQL</option><option value="mysql">MySQL / MariaDB</option><option value="sqlite">SQLite</option>
            </select>
          </Field>
          <div className="stats"><div><b>{schema.tables.length}</b><span>tables</span></div><div><b>{schema.tables.reduce((n, x) => n + x.columns.length, 0)}</b><span>colonnes</span></div><div><b>{nRel}</b><span>relations</span></div></div>
          <div className="tips">
            <p><b>Ajouter une table</b> : bouton « Table » ou double-clic sur le canevas.</p>
            <p><b>Créer une relation</b> : tire depuis le point d'une colonne vers celui d'une autre table.</p>
            <p><b>Supprimer</b> : sélectionne un lien ou une table et appuie sur Suppr.</p>
            <p><b>Annuler</b> : Ctrl+Z, refaire : Ctrl+Maj+Z.</p>
          </div>
        </div>
      )}
    </aside>
  );
}
