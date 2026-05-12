import type { EmbedBody, EmbedResponse, SttResponse } from '@/lib/types';
import { apiPostJson, apiPostMultipart } from '@/lib/api';
import { appendToRecording, writeRecording } from '../store/fileStore';
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

/**
 * 기존 녹음에 새 음성을 이어붙여 STT/임베딩 후 append 한다.
 * - 새로 녹음한 m4a 한 건만 서버에 전송 (전체 재처리 X — 속도/비용 절감)
 * - 결과는 기존 녹음의 transcript/chunks 뒤에 그대로 이어붙음
 * - 본문이 바뀌므로 캐시된 요약은 무효화됨 (사용자가 "다시 요약하기"로 갱신)
 */
export async function appendAudio(
  existingId: string,
  asset: { uri: string; mimeType?: string | null; name?: string | null },
  onStage?: (s: Stage) => void,
): Promise<RecordingFile> {
  onStage?.('stt');

  const formData = new FormData();
  formData.append(
    'file',
    {
      uri: asset.uri,
      name: asset.name ?? 'recording.m4a',
      type: asset.mimeType ?? 'audio/m4a',
    } as unknown as Blob,
  );

  const stt = await apiPostMultipart<SttResponse>('/stt', formData);

  onStage?.('embed');
  const embed = await apiPostJson<EmbedResponse>('/embed', { texts: stt.chunks } satisfies EmbedBody);

  if (embed.vectors.length !== stt.chunks.length) {
    throw new Error('embed_count_mismatch');
  }

  onStage?.('saving');
  const updated = await appendToRecording(existingId, stt.transcript, stt.chunks, embed.vectors);
  if (!updated) {
    throw new Error('recording_not_found');
  }
  return updated;
}
