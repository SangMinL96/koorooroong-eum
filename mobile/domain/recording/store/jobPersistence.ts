import * as FileSystem from 'expo-file-system';
import type { FailedJob, UploadJob } from './useRecordingsStore';

const path = () => `${FileSystem.documentDirectory}upload-job.json`;

export type PersistedJobs = {
  activeJob: UploadJob | null;
  failedJob: FailedJob | null;
};

export async function loadPersistedJobs(): Promise<PersistedJobs> {
  const info = await FileSystem.getInfoAsync(path());
  if (!info.exists) return { activeJob: null, failedJob: null };
  try {
    const raw = await FileSystem.readAsStringAsync(path());
    const parsed = JSON.parse(raw) as Partial<PersistedJobs>;
    return {
      activeJob: parsed.activeJob ?? null,
      failedJob: parsed.failedJob ?? null,
    };
  } catch {
    return { activeJob: null, failedJob: null };
  }
}

// 같은 파일에 연속 쓰기 시 순서 보장을 위한 단일 큐.
let chain: Promise<void> = Promise.resolve();

export function enqueuePersistJobs(snapshot: PersistedJobs): void {
  chain = chain
    .then(() => FileSystem.writeAsStringAsync(path(), JSON.stringify(snapshot)))
    .catch(() => undefined);
}
