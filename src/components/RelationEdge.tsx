import { BaseEdge, getSmoothStepPath, Position, type EdgeProps } from "@xyflow/react";

const DIR: Record<string, [number, number]> = { [Position.Left]: [-1, 0], [Position.Right]: [1, 0], [Position.Top]: [0, -1], [Position.Bottom]: [0, 1] };
/** Pied de corbeau (côté « plusieurs ») ou barre (côté « un »), orienté vers l'extérieur de la carte. */
function mark(x: number, y: number, pos: Position, kind: "many" | "one") {
  const [dx, dy] = DIR[pos] || [1, 0]; const px = -dy, py = dx;
  if (kind === "one") {
    const cx = x + dx * 10, cy = y + dy * 10;
    return `M${cx + px * 6},${cy + py * 6}L${cx - px * 6},${cy - py * 6}M${x + dx * 15 + px * 6},${y + dy * 15 + py * 6}L${x + dx * 15 - px * 6},${y + dy * 15 - py * 6}`;
  }
  // trois dents qui touchent la carte, un seul trait côté lien
  const bx = x + dx * 12, by = y + dy * 12;
  return `M${bx},${by}L${x + px * 6},${y + py * 6}M${bx},${by}L${x - px * 6},${y - py * 6}M${bx},${by}L${x},${y}M${x + dx * 14 + px * 6},${y + dy * 14 + py * 6}L${x + dx * 14 - px * 6},${y + dy * 14 - py * 6}`;
}
export function RelationEdge(p: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX: p.sourceX, sourceY: p.sourceY, sourcePosition: p.sourcePosition, targetX: p.targetX, targetY: p.targetY, targetPosition: p.targetPosition, borderRadius: 10, offset: 24 });
  const one = (p.data as any)?.one;
  return (
    <>
      <BaseEdge id={p.id} path={path} className="rel-edge" interactionWidth={18} />
      <path className="rel-mark" d={mark(p.sourceX, p.sourceY, p.sourcePosition, one ? "one" : "many")} fill="none" />
      <path className="rel-mark" d={mark(p.targetX, p.targetY, p.targetPosition, "one")} fill="none" />
    </>
  );
}
