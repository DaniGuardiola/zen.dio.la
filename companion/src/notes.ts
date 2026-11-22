import { byId } from "./curriculum.ts";

/** The teaching notes for one view, as the monk reads them. */
export function notes(id: string) {
  const n = byId(id)!;
  return [
    `VIEW ${n.id}${n.optional ? " (optional)" : ""}: "${n.view}"`,
    `Recognise it in phrasings like: ${n.phrasings.join(" | ")}`,
    `Probes:\n${n.probes.map((p) => `- ${p}`).join("\n")}`,
    `Consequences (draw out one at a time, from their own words):\n${n.consequences.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
    `Signs it is truly seen through:\n${n.signs.map((s) => `- ${s}`).join("\n")}`,
    `Insight: ${n.insight}`,
    `Pitfalls:\n${n.pitfalls.map((p) => `- ${p}`).join("\n")}`,
    `Sources (paraphrases, cite loosely, never as exact quotes):\n${n.sources.map((s) => `- ${s.ref}: ${s.gist}`).join("\n")}`,
  ].join("\n\n");
}
