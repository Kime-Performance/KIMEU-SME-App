export type CatalogWorkshop = { id: string; name: string; stage: string };

function normalized(value: string): string {
  return value.toLowerCase().replace(/\bkb\b/g, "kettlebell").replace(/[^a-z0-9]+/g, " ").trim();
}

// Only catalog names/IDs and explicit workshop titles qualify. Do not infer
// credit, roster membership, or attendance from a calendar event.
export function classifyWorkshop(title: string, catalog: CatalogWorkshop[]) {
  const text = ` ${normalized(title)} `;
  const matchesName = (item: CatalogWorkshop) =>
    text.includes(` ${normalized(item.id)} `) ||
    (normalized(item.name).length >= 6 && text.includes(` ${normalized(item.name)} `));
  const eligible = catalog.filter((item) => /^(foundations|advanced|fellowship)$/i.test(item.stage));
  const matches = eligible.filter(matchesName);
  const excluded = catalog.some((item) => !eligible.includes(item) && matchesName(item));
  return {
    include: !excluded && (matches.length > 0 || /\bworkshop\b|\badvanced\s+(course|workshop)\b/i.test(title)),
    workshop: matches.length === 1 ? matches[0] : null,
  };
}
