import type { EmbedBody, EmbedResponse, SttResponse } from '@/lib/types';
import { apiPostJson, apiPostMultipart } from '@/lib/api';
import { writeRecording } from '../store/fileStore';
import type { RecordingChunk, RecordingFile } from '../types';

type UploadInput = {
  name: string;
  /**
   * expo-document-picker가 반환한 asset.
   * - uri: file:// URI
   * - mimeType: 사용자가 선택한 파일의 MIME
   * - name: 파일명 (확장자 포함)
   */
  asset: { uri: string; mimeType?: string | null; name?: string | null };
};

type Stage = 'stt' | 'embed' | 'saving';

function randomSuffix(): string {
  const arr = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += arr[Math.floor(Math.random() * arr.length)];
  return s;
}

function newRecordingId(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `rec_${iso}_${randomSuffix()}`;
}

export async function uploadAudio(
  input: UploadInput,
  onStage?: (s: Stage) => void,
): Promise<RecordingFile> {
  onStage?.('stt');

  const formData = new FormData();
  // React Native FormData에서 파일 첨부는 { uri, name, type } 객체 형태
  formData.append(
    'file',
    {
      uri: input.asset.uri,
      name: input.asset.name ?? 'recording.m4a',
      type: input.asset.mimeType ?? 'audio/m4a',
    } as unknown as Blob,
  );

  const stt = await apiPostMultipart<SttResponse>('/stt', formData);

  onStage?.('embed');
  const embed = await apiPostJson<EmbedResponse>('/embed', { texts: stt.chunks } satisfies EmbedBody);

  if (embed.vectors.length !== stt.chunks.length) {
    throw new Error('embed_count_mismatch');
  }

  onStage?.('saving');
  const id = newRecordingId();
  const createdAt = new Date().toISOString();
  const chunks: RecordingChunk[] = stt.chunks.map((text, idx) => ({
    index: idx,
    text,
    embedding: embed.vectors[idx],
  }));
  const rec: RecordingFile = {
    id,
    name: input.name.trim() || (input.asset.name ?? 'untitled'),
    createdAt,
    transcript: stt.transcript,
    chunks,
  };
  await writeRecording(rec);
  return rec;
}
