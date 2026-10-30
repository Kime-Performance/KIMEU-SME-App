export function matchesParticipantSearch(search: string, name: string, email: string, location = '') {
  const normalize = (value: string) => value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const terms = normalize(search).split(/\s+/).filter(Boolean);
  const searchable = normalize(`${name} ${location} ${email}`);
  const givenName = normalize(name).split(/\s+/)[0];
  // Search aliases only; the roster name and email remain the saved identity.
  const aliases = new Map<string, readonly string[]>([
    ['nate', ['nathan', 'nathaniel']],
  ]);
  return terms.every(term => searchable.includes(term) ||
    aliases.get(term)?.includes(givenName));
}
