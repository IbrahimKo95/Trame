import { getNodesBounds, getViewportForBounds, type ReactFlowInstance } from "@xyflow/react";
import { toPng, toJpeg, toSvg } from "html-to-image";
import { jsPDF } from "jspdf";

let rf: ReactFlowInstance | null = null;
export const setRf = (i: ReactFlowInstance | null) => { rf = i; };
export const getRf = () => rf;
/** Centre visible du canevas, en coordonnées du schéma (pour poser une nouvelle table). */
export function viewCenter(): { x: number; y: number } | null {
  const el = document.querySelector(".canvas") as HTMLElement | null; if (!rf || !el) return null;
  const r = el.getBoundingClientRect();
  const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  return { x: Math.round(p.x - 132), y: Math.round(p.y - 80) };
}

export type ImgFormat = "png" | "jpg" | "svg" | "pdf";
export interface ImgOpts { format: ImgFormat; scale: number; transparent: boolean; name: string }

function download(url: string, filename: string) { const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
export function downloadText(text: string, filename: string, mime = "text/plain") { const u = URL.createObjectURL(new Blob([text], { type: mime })); download(u, filename); setTimeout(() => URL.revokeObjectURL(u), 2000); }
const slug = (s: string) => (s || "schema").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema";

export async function exportImage(o: ImgOpts): Promise<void> {
  if (!rf) throw new Error("Canevas indisponible");
  const nodes = rf.getNodes();
  if (!nodes.length) throw new Error("Le schéma est vide.");
  const el = document.querySelector(".react-flow__viewport") as HTMLElement | null;
  if (!el) throw new Error("Canevas introuvable");
  const pad = 48;
  const b = getNodesBounds(nodes);
  const w = Math.ceil(b.width + pad * 2), h = Math.ceil(b.height + pad * 2);
  const vp = getViewportForBounds(b, w, h, 0.05, 4, pad / Math.max(w, h));
  const cs = getComputedStyle(document.querySelector(".canvas") as Element);
  const bg = cs.getPropertyValue("--cv-bg").trim() || "#0b0c0e";
  const common: any = {
    width: w, height: h, pixelRatio: o.scale, cacheBust: true,
    backgroundColor: o.transparent && o.format === "png" ? undefined : bg,
    style: { width: w + "px", height: h + "px", transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
  };
  const run = async (opts: any) => (o.format === "svg" ? toSvg(el, opts) : o.format === "jpg" || o.format === "pdf" ? toJpeg(el, { ...opts, quality: 0.95 }) : toPng(el, opts));
  // Les styles des liens viennent de la feuille de style, que html-to-image n'emporte pas pour les SVG :
  // on les fige en attributs le temps de la capture, et on masque les poignées et la sélection.
  const canvas = document.querySelector(".canvas") as HTMLElement;
  const marks = Array.from(el.querySelectorAll<SVGElement>(".rel-edge,.rel-mark"));
  marks.forEach((m) => { const c = getComputedStyle(m); m.setAttribute("stroke", c.stroke); m.setAttribute("stroke-width", c.strokeWidth); });
  canvas.classList.add("exporting");
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let url: string;
  try {
    try { url = await run(common); } catch { url = await run({ ...common, skipFonts: true }); }
  } finally {
    canvas.classList.remove("exporting");
    marks.forEach((m) => { m.removeAttribute("stroke"); m.removeAttribute("stroke-width"); });
  }
  const base = slug(o.name);
  if (o.format === "pdf") {
    const pdf = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "px", format: [w, h], hotfixes: ["px_scaling"] });
    pdf.addImage(url, "JPEG", 0, 0, w, h, undefined, "FAST"); pdf.save(base + ".pdf"); return;
  }
  download(url, `${base}.${o.format === "jpg" ? "jpg" : o.format}`);
}
