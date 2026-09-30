import { useCallback, useEffect, useMemo, useRef } from "react";
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode, useNodesState, useNodesInitialized, useReactFlow, type Connection, type Edge, type Node } from "@xyflow/react";
import { useSchema, useStore, setUi, updateTable, setRef, deleteTable, checkpoint, addTable, getState } from "../store";
import { TableNode } from "./TableNode";
import { RelationEdge } from "./RelationEdge";
import { setRf } from "../lib/image";

const nodeTypes = { table: TableNode };
const edgeTypes = { rel: RelationEdge };
const W = 264;

function Inner() {
  const schema = useSchema();
  const selTable = useStore((s) => s.selTable);
  const theme = useStore((s) => s.theme);
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  useEffect(() => { setRf(rf); return () => setRf(null); }, [rf]);
  // Cadre tout le schéma dès que les cartes sont mesurées (et à chaque changement de schéma).
  const ready = useNodesInitialized();
  const fitted = useRef("");
  useEffect(() => {
    if (ready && fitted.current !== schema.id) { fitted.current = schema.id; rf.fitView({ padding: 0.18, maxZoom: 1 }); }
  }, [ready, schema.id, rf]);

  // Synchronise les nœuds avec le schéma en conservant les dimensions mesurées.
  useEffect(() => {
    setNodes((prev) => schema.tables.map((t) => {
      const old = prev.find((n) => n.id === t.id);
      return { ...(old || {}), id: t.id, type: "table", position: { x: t.x, y: t.y }, data: {}, selected: selTable === t.id, dragHandle: ".tn-head" } as Node;
    }));
  }, [schema.tables.map((t) => t.id + ":" + t.x + ":" + t.y).join("|"), selTable]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (const t of schema.tables) for (const c of t.columns) {
      if (!c.ref) continue;
      const target = schema.tables.find((x) => x.id === c.ref!.table);
      if (!target || !target.columns.some((k) => k.id === c.ref!.column)) continue;
      const self = target.id === t.id;
      const left = t.x + W / 2 < target.x + W / 2 - 20;
      const right = t.x + W / 2 > target.x + W / 2 + 20;
      const sh = self ? "-r" : left ? "-r" : right ? "-l" : "-r";
      const th = self ? "-r" : left ? "-l" : right ? "-r" : "-r";
      out.push({ id: "e_" + c.id, source: t.id, sourceHandle: c.id + sh, target: target.id, targetHandle: c.ref.column + th, type: "rel", data: { one: c.unique || c.pk } });
    }
    return out;
  }, [schema.tables]);

  const onConnect = useCallback((c: Connection) => {
    if (!c.sourceHandle || !c.targetHandle) return;
    const sc = c.sourceHandle.slice(0, -2), tc = c.targetHandle.slice(0, -2);
    if (c.source === c.target && sc === tc) return;
    setRef(c.source!, sc, { table: c.target!, column: tc, onDelete: "no action", onUpdate: "no action" });
    setUi({ selTable: c.source!, selCol: sc });
  }, []);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={onNodesChange} onConnect={onConnect} connectionMode={ConnectionMode.Loose}
      onNodeClick={(_, n) => setUi({ selTable: n.id })}
      onPaneClick={() => setUi({ selTable: null, selCol: null })}
      onNodeDragStart={() => checkpoint()}
      onNodeDragStop={(_, n) => updateTable(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }, false)}
      onNodesDelete={(ns) => ns.forEach((n) => deleteTable(n.id))}
      onEdgesDelete={(es) => es.forEach((e) => { const t = getState().schemas.find((s) => s.id === getState().activeId)!.tables.find((x) => x.id === e.source); const cid = e.id.slice(2); if (t) setRef(t.id, cid, null); })}
      onDoubleClick={(ev) => { if ((ev.target as HTMLElement).classList.contains("react-flow__pane")) { const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }); addTable(Math.round(p.x - W / 2), Math.round(p.y - 20)); } }}
      zoomOnDoubleClick={false} deleteKeyCode={["Backspace", "Delete"]} minZoom={0.15} maxZoom={2}
      proOptions={{ hideAttribution: true }}
      colorMode={theme}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => schema.tables.find((t) => t.id === n.id)?.color || "#888"} maskColor={theme === "dark" ? "rgba(0,0,0,.45)" : "rgba(240,240,232,.7)"} />
    </ReactFlow>
  );
}
export const Canvas = () => (<div className="canvas"><Inner /></div>);
