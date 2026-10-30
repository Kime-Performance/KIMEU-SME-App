import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetKimeuPracticalsQueryKey, useSaveKimeuPracticalSchedule,
  type PracticalRecord, type PracticalWorkspace,
} from '@workspace/api-client-react';
import { practicalWindow } from '../lib/practical-window';

type Props = {
  workshopId: string; record: PracticalRecord; today: string;
  onBusyChange: (busy: boolean) => void; onClose: () => void;
  onSaved: (message: string) => void; onReview: () => Promise<PracticalWorkspace>;
};

export function PracticalSchedule({ workshopId, record, today, onBusyChange, onClose, onSaved, onReview }: Props) {
  const client = useQueryClient();
  const save = useSaveKimeuPracticalSchedule({ mutation: { retry: false } });
  const window = practicalWindow(record.sessionDate, '', today);
  const min = record.sessionDate > today ? record.sessionDate : today;
  const [date, setDate] = useState(record.scheduledDate && record.scheduledDate >= min ? record.scheduledDate : min);
  const [revision, setRevision] = useState(record.revision);
  const [error, setError] = useState<{ text: string; review?: boolean; revision?: string } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { onBusyChange(save.isPending || reviewing); }, [save.isPending, reviewing, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const submit = (scheduledDate: string | null) => {
    if (save.isPending || error?.review) return;
    if (scheduledDate !== null && (!window || scheduledDate < min || scheduledDate > window.end)) {
      setError({ text: `Choose today or a future date between ${record.sessionDate} and ${window?.end ?? 'two weeks after the workshop'}.` });
      return;
    }
    setError(null);
    save.mutate({ workshopId, data: { recordKey: record.recordKey, revision, scheduledDate } }, {
      onSuccess: workspace => {
        client.setQueryData(getGetKimeuPracticalsQueryKey(workshopId), workspace);
        if (workspace.records.find(r => r.recordKey === record.recordKey)?.scheduledDate !== scheduledDate) {
          setError({ text: 'The saved schedule could not be confirmed. Your date is kept. Review the latest values before retrying.', review: true });
          return;
        }
        onSaved(scheduledDate ? `Practical scheduled for ${scheduledDate}. Attendance, practical completion and K-Star results are unchanged.` : 'Practical schedule removed. Completion evidence and scheduling history are unchanged.');
      },
      onError: failure => {
        const e = failure as { data?: { error?: string } };
        setError({ text: `${e.data?.error || 'The schedule could not be confirmed.'} Your selected date is kept. Review the latest saved values before retrying.`, review: true });
      },
    });
  };
  const review = async () => {
    setReviewing(true);
    try {
      const latest = (await onReview()).records.find(r => r.recordKey === record.recordKey);
      if (!latest) throw new Error('Record unavailable');
      setError({ text: `Latest schedule: ${latest.scheduledDate || 'Not scheduled'}. Your date is kept. Review the saved card/history before using this version.`, review: true, revision: latest.revision });
    } catch {
      setError({ text: 'The latest record could not be loaded. Your date is kept. Try reviewing again shortly.', review: true });
    } finally { setReviewing(false); }
  };
  const closed = !window || min > window.end;
  return <form className="practical-form" data-testid="form-practical-schedule" onSubmit={e => { e.preventDefault(); submit(date); }}>
    <h3>Schedule practical — {record.name || record.clinicianEmail}</h3>
    <p className="ct-meta">Plan a practical within two weeks after this workshop ({record.sessionDate} through {window?.end}). This does not record attendance, mark Pass/Fail, or award K-Star. No Google Calendar event is created.</p>
    {closed ? <p role="status">This workshop’s two-week scheduling window has ended. Use RD practical completion to record a practical that already happened.</p>
      : <label>Scheduled practical date<input type="date" required min={min} max={window.end} value={date} disabled={save.isPending || reviewing} onChange={e => setDate(e.target.value)} data-testid="input-scheduled-practical-date" /></label>}
    {error && <div className="inline-message inline-message-error" role="alert" data-testid="error-practical-schedule">{error.text}
      {error.review && <button type="button" className="practical-link" onClick={review} disabled={save.isPending || reviewing}>Review latest saved values</button>}
      {error.revision && <button type="button" className="practical-link" disabled={reviewing || save.isPending || error.revision !== record.revision} onClick={() => { setRevision(error.revision!); setError(null); }}>Use reviewed version for this date</button>}
    </div>}
    <div className="close-actions">
      <button type="button" className="button-quiet" onClick={onClose} disabled={save.isPending || reviewing}>Cancel</button>
      {record.scheduledDate && <button type="button" className="button-quiet" onClick={() => submit(null)} disabled={save.isPending || reviewing || !!error?.review} data-testid="button-remove-practical-schedule">Remove schedule</button>}
      {!closed && <button type="submit" className="practical-save" disabled={save.isPending || reviewing || !!error?.review} data-testid="button-save-practical-schedule">{save.isPending ? 'Saving schedule…' : 'Save scheduled date'}</button>}
    </div>
  </form>;
}
