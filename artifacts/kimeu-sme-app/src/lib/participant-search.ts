export function matchesParticipantSearch(search: string, name: string, email: string, location = '') {
  const query = search.trim().toLowerCase();
  return !query || `${name} ${location} ${email}`.toLowerCase().includes(query);
}
