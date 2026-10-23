import { useCallback, useEffect, useRef, useState } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetKimeuSessionQueryKey,
  getGetKimeuTodayQueryKey,
  useSaveKimeuAttendance,
} from '@workspace/api-client-react';

type PendingMark = { clinicianEmail: string; attended: 'Yes' | 'No'; revision: string };

/** Only attendance taps are stored offline; notes are never stored here. */
export function useAttendanceQueue(sessionId: string, enabled: boolean) {
  const { user } = useClerk();
  const client = useQueryClient();
  const mutation = useSaveKimeuAttendance();
  const key = user ? `kimeu-attendance:${user.id}:${sessionId}` : null;
  const queue = useRef<PendingMark[]>([]);
  const busy = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const save = mutation.mutateAsync;

  const persist = useCallback(() => {
    if (!key) throw new Error('Sign in before recording attendance.');
    localStorage.setItem(key, JSON.stringify(queue.current));
    setPendingCount(queue.current.length);
  }, [key]);

  const flush = useCallback(async () => {
    if (!key || !enabled || !navigator.onLine || busy.current || !queue.current.length) return;
    busy.current = true;
    setSyncing(true);
    const submitted = [...queue.current];
    try {
      await save({
        sessionId,
        data: { marks: submitted.map(({ clinicianEmail, attended }) => ({ clinicianEmail, attended })) },
      });
      // Keep any newer tap made while this request was in flight.
      queue.current = queue.current.filter((mark) => !submitted.some((sent) => sent.revision === mark.revision));
      persist();
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetKimeuSessionQueryKey(sessionId) }),
        client.invalidateQueries({ queryKey: getGetKimeuTodayQueryKey() }),
      ]);
      setMessage(queue.current.length ? 'Newer attendance taps are waiting to sync.' : 'Attendance confirmed by the connected sheet.');
    } catch {
      setMessage('Attendance is pending on this device. Reconnect or retry; it has not been confirmed as saved.');
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [key, enabled, save, sessionId, persist, client]);

  useEffect(() => {
    queue.current = [];
    try {
      const stored = key ? JSON.parse(localStorage.getItem(key) || '[]') : [];
      if (Array.isArray(stored)) {
        queue.current = stored.filter((mark): mark is PendingMark =>
          typeof mark?.clinicianEmail === 'string' &&
          (mark.attended === 'Yes' || mark.attended === 'No') &&
          typeof mark.revision === 'string');
      }
      setPendingCount(queue.current.length);
      setMessage(queue.current.length ? 'Attendance restored from this device is still pending sheet confirmation.' : '');
    } catch {
      setMessage('This browser cannot restore offline attendance. Keep this page open and retry online.');
    }
  }, [key]);

  useEffect(() => {
    void flush();
    const online = () => void flush();
    window.addEventListener('online', online);
    const retry = window.setInterval(online, 30_000);
    return () => { window.removeEventListener('online', online); window.clearInterval(retry); };
  }, [flush]);

  function mark(clinicianEmail: string, attended: 'Yes' | 'No') {
    if (!enabled || !key) return;
    const previous = queue.current;
    queue.current = [
      ...previous.filter((item) => item.clinicianEmail !== clinicianEmail),
      { clinicianEmail, attended, revision: crypto.randomUUID() },
    ];
    try {
      persist();
      setMessage(navigator.onLine ? 'Attendance pending confirmation…' : 'Offline: attendance is queued on this device.');
      void flush();
    } catch {
      queue.current = previous;
      setMessage('Attendance was not recorded: offline storage is unavailable.');
    }
  }

  return { mark, pendingCount, syncing, message, retry: flush };
}
