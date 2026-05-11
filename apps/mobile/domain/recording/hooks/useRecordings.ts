import useSWR from 'swr';
import { listRecordings, readRecording } from '../store/fileStore';
import type { RecordingFile, RecordingMeta } from '../types';

const LIST_KEY = 'recordings';
const RECORDING_KEY = (id: string) => ['recording', id] as const;

export function useRecordings() {
  return useSWR<RecordingMeta[]>(LIST_KEY, () => listRecordings());
}

export function useRecording(id: string | undefined) {
  return useSWR<RecordingFile | null>(
    id ? RECORDING_KEY(id) : null,
    () => readRecording(id as string),
  );
}

export const recordingsKeys = { list: LIST_KEY, byId: RECORDING_KEY };
