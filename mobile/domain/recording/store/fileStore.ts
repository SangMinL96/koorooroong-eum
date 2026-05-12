import * as FileSystem from 'expo-file-system';
import type { GroundingSource } from '@/lib/types';
import type { RecordingFile, RecordingIndex, RecordingMeta } from '../types';

const baseDir = () => `${FileSystem.documentDirectory}recordings/`;
const indexPath = () => `${FileSystem.documentDirectory}index.json`;
const recordingPath = (id: string) => `${baseDir()}${id}.json`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(baseDir());
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(baseDir(), { intermediates: true });
  }
}

export async function readIndex(): Promise<RecordingIndex> {
  const info = await FileSystem.getInfoAsync(indexPath());
  if (!info.exists) {
    return { version: 1, recordings: [] };
  }
  const raw = await FileSystem.readAsStringAsync(indexPath());
  try {
    const parsed = JSON.parse(raw) as RecordingIndex;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.recordings)) {
      return { version: 1, recordings: [] };
    }
    return parsed;
  } catch {
    return { version: 1, recordings: [] };
  }
}

export async function writeIndex(index: RecordingIndex): Promise<void> {
  await FileSystem.writeAsStringAsync(indexPath(), JSON.stringify(index));
}

export async function readRecording(id: string): Promise<RecordingFile | null> {
  const info = await FileSystem.getInfoAsync(recordingPath(id));
  if (!info.exists) return null;
  const raw = await FileSystem.readAsStringAsync(recordingPath(id));
  return JSON.parse(raw) as RecordingFile;
}

export async function writeRecording(rec: RecordingFile): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(recordingPath(rec.id), JSON.stringify(rec));
  const index = await readIndex();
  const meta: RecordingMeta = {
    id: rec.id,
    name: rec.name,
    createdAt: rec.createdAt,
    chunkCount: rec.chunks.length,
  };
  const existing = index.recordings.findIndex((r) => r.id === rec.id);
  if (existing >= 0) {
    index.recordings[existing] = meta;
  } else {
    index.recordings.unshift(meta);
  }
  await writeIndex(index);
}

export async function updateRecordingSummary(
  id: string,
  summary: string,
  sources?: GroundingSource[],
): Promise<RecordingFile | null> {
  const rec = await readRecording(id);
  if (!rec) return null;
  const next: RecordingFile = {
    ...rec,
    summary,
    summaryAt: new Date().toISOString(),
    summarySources: sources && sources.length > 0 ? sources : undefined,
  };
  await FileSystem.writeAsStringAsync(recordingPath(id), JSON.stringify(next));
  return next;
}

export async function deleteRecording(id: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(recordingPath(id));
  if (info.exists) {
    await FileSystem.deleteAsync(recordingPath(id), { idempotent: true });
  }
  const index = await readIndex();
  index.recordings = index.recordings.filter((r) => r.id !== id);
  await writeIndex(index);
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const index = await readIndex();
  return [...index.recordings].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
