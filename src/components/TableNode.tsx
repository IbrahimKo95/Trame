import { memo, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useStore, addColumn, setUi, active } from "../store";
import { Ic } from "./bits";

const TYPE_SHORT: Record<string, string> = { increments: "int++", bigIncrements: "bigint++", integer: "int", bigInteger: "bigint", smallInteger: "smallint", decimal: "decimal", float: "float", boolean: "bool", string: "varchar", text: "text", uuid: "uuid", date: "date", datetime: "datetime", timestamp: "timestamp", time: "time", json: "json", enum: "enum", binary: "binary" };

export const TableNode = memo(({ id, selected }: NodeProps) => {
  const table = useStore((s) => active(s).tables.find((t) => t.id === id));
  const selCol = useStore((s) => (s.selTable === id ? s.selCol : null));
  const update = useUpdateNodeInternals();
  const sig = table ? table.columns.map((c) => c.id).join() : "";
  useEffect(() => { update(id); }, [sig, id, update]);
  if (!table) return null;
  return (
    <div className={"tnode" + (selected ? " is-sel" : "")} style={{ ["--tc" as any]: table.color }}>
      <div className="tn-head">
        <span className="tn-dot" />
        <b title={table.comment || table.name}>{table.name}</b>
        <small>{table.columns.length}</small>
      </div>
      <div className="tn-body">
        {table.columns.map((c) => (
          <div key={c.id} className={"tn-row" + (selCol === c.id ? " is-col" : "")} onClick={() => setUi({ selTable: id, selCol: c.id })}>
            <Handle id={c.id + "-l"} type="source" position={Position.Left} className="tn-h" />
            <span className="tn-ico">{c.pk ? <Ic name="key" size={12} /> : c.ref ? <Ic name="link" size={12} /> : null}</span>
            <span className={"tn-name" + (c.pk ? " pk" : "")}>{c.name}</span>
            <span className="tn-flags">{c.unique && !c.pk ? <i>U</i> : null}{c.nullable && !c.pk ? <i className="n">?</i> : null}</span>
            <span className="tn-type">{TYPE_SHORT[c.type] || c.type}</span>
            <Handle id={c.id + "-r"} type="source" position={Position.Right} className="tn-h" />
          </div>
        ))}
      </div>
      <button className="tn-add nodrag" onClick={(e) => { e.stopPropagation(); addColumn(id); }}><Ic name="plus" size={12} />colonne</button>
    </div>
  );
});
