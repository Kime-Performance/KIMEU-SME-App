import { useState, type ReactNode } from 'react';
import type { CourseTrackingPerson } from '@workspace/api-client-react';
import { CourseTracking } from './course-tracking';
import { CoursePracticals } from './course-practicals';
import { matchesParticipantSearch } from '@/lib/participant-search';

export function WorkshopWorkspace({ workshopId, children }: { workshopId: string; children?: ReactNode }) {
  const [search, setSearch] = useState('');
  const [roster, setRoster] = useState<CourseTrackingPerson[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [practicalDirty, setPracticalDirty] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [practicalBusy, setPracticalBusy] = useState(false);
  const busy = attendanceBusy || practicalBusy;
  const matches = roster.filter(person => matchesParticipantSearch(search, person.name, person.email, person.location));
  const selected = roster.find(person => person.email === selectedEmail);
  function canSwitch() {
    return !busy && (!(attendanceDirty || practicalDirty) ||
      window.confirm('You have unsaved attendance or practical changes for the selected PT. Discard them and switch PTs?'));
  }
  function choose(email: string) {
    if (email === selectedEmail || !canSwitch()) return;
    setSelectedEmail(email);
  }
  function searchFor(value: string) {
    if (busy) return;
    const found = roster.filter(person => matchesParticipantSearch(value, person.name, person.email, person.location));
    const nextEmail = value.trim() && found.length === 1 ? found[0].email : '';
    if (nextEmail !== selectedEmail && !canSwitch()) return;
    setSearch(value);
    setSelectedEmail(nextEmail);
  }
  return <>
    <section className="ct-panel pt-selector" aria-label="Select workshop PT" data-testid="panel-select-workshop-pt">
      <h2>Select a PT</h2>
      <p className="ct-explain">Choose a PT or search by name, email or location. Attendance and RD practicals below belong only to the selected PT.</p>
      <div className="ct-toolbar">
        <label className="ct-field ct-search"><span>Search PTs</span><input type="search" value={search} onChange={event => searchFor(event.target.value)} disabled={busy} placeholder="Name, email or location" data-testid="input-search-pts" /></label>
        <label className="ct-field"><span>PT</span><select value={selectedEmail} onChange={event => choose(event.target.value)} disabled={busy || !roster.length} data-testid="select-workshop-pt">
          <option value="">Select a PT</option>
          {matches.map(person => <option key={person.email} value={person.email}>{person.name} — {person.email}{person.location ? ` — ${person.location}` : ''}</option>)}
        </select></label>
      </div>
      {search.trim() && !matches.length && <p role="status">No PTs match this search.</p>}
      {selectedEmail && <p role="status" data-testid="text-selected-workshop-pt"><strong>Selected PT: {selected?.name || selectedEmail}</strong> — {selectedEmail}</p>}
    </section>
    <CourseTracking workshopId={workshopId} selectedEmail={selectedEmail} onRosterChange={setRoster} onDirtyChange={setAttendanceDirty} onBusyChange={setAttendanceBusy} />
    {selectedEmail && <CoursePracticals workshopId={workshopId} selectedEmail={selectedEmail} onDirtyChange={setPracticalDirty} onBusyChange={setPracticalBusy} />}
    {children}
  </>;
}
