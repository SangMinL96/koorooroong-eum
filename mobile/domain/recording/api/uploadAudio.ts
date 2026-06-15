import * as FileSystem from 'expo-file-system';
import type { EmbedBody, EmbedResponse, SttJobCreated, SttJobStatus, SttResponse } from '@/lib/types';
import { ApiError, apiGetJson, apiPostJson, parseApiEnvelope } from '@/lib/api';
import { inferAudioMime } from '@/lib/audioMime';
import { API_HOST } from '@/lib/env';
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

function uuidLike(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) s += '-';
    s += hex[Math.floor(Math.random() * 16)];
  }
  return s;
}

function extractExt(name?: string | null, fallback = 'm4a'): string {
  if (!name) return fallback;
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : fallback;
}

/**
 * 한국어/특수문자 파일명이 multipart filename 으로 들어가면 일부 Android 디바이스에서
 * 잘못 인코딩돼 서버가 400 으로 거부한다. 업로드 직전에 ASCII UUID 이름으로 캐시에 복사.
 * 사용자에게 보이는 이름은 RecordingFile.name 에 그대로 남는다.
 */
async function copyToAsciiCachePath(srcUri: string, originalName?: string | null): Promise<string> {
  const ext = extractExt(originalName);
  const dest = `${FileSystem.cacheDirectory}upload-${uuidLike()}.${ext}`;
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  return dest;
}

/** 폴링 주기. 서버는 작업을 인메모리에 들고 있으므로 짧게 자주 확인해도 부담 적음. */
const STT_POLL_INTERVAL_MS = 2000;
/** 전체 폴링 한계. 서버 위스퍼 요청당 한계(10분)와 맞춤. */
const STT_POLL_TIMEOUT_MS = 10 * 60 * 1000;
/** 폴링 중 일시적 네트워크 오류 허용 횟수 (연속). 초과 시 실패 처리. */
const STT_POLL_MAX_TRANSIENT_ERRORS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * jobId 를 받아 GET /stt/:jobId 로 결과를 폴링한다.
 * - done → 전사 결과 반환
 * - error → 서버가 보고한 사유로 throw
 * - 404(ApiError) → 작업 유실(서버 재시작 등) 즉시 실패
 * - 그 외 네트워크 블립 → 몇 번까지 관용 후 재시도
 */
async function pollSttJob(jobId: string): Promise<SttResponse> {
  const deadline = Date.now() + STT_POLL_TIMEOUT_MS;
  let transientErrors = 0;
  while (Date.now() < deadline) {
    let status: SttJobStatus | null = null;
    try {
      status = await apiGetJson<SttJobStatus>(`/stt/${jobId}`);
      transientErrors = 0;
    } catch (err) {
      // 서버가 작업을 모르면(404 등) 재시도 의미 없음 → 즉시 실패.
      if (err instanceof ApiError) throw err;
      // 네트워크 블립은 한도까지 관용.
      if (++transientErrors > STT_POLL_MAX_TRANSIENT_ERRORS) throw err;
    }
    if (status) {
      if (status.status === 'done') return status.result;
      if (status.status === 'error') throw new Error(status.error || 'stt_failed');
    }
    await sleep(STT_POLL_INTERVAL_MS);
  }
  throw new Error('stt_timeout');
}

/**
 * STT 업로드. expo-file-system 의 native upload task (iOS URLSession background) 로 파일을 보내고
 * 서버는 즉시 jobId 만 반환(202)하므로 업로드 연결은 짧게 끝난다.
 * 이후 GET /stt/:jobId 폴링으로 전사 결과를 받는다.
 *  → 긴 위스퍼 처리 동안 무음 연결을 유지하다 클라이언트 타임아웃 나던 문제를 해소.
 * - iOS: sessionType=BACKGROUND → JS suspend 후에도 OS 가 업로드를 끝까지 끌고 감
 * - Android: sessionType 무시(항상 native task), 단 OS Doze 영향은 남으므로 keep-awake 와 병행
 */
async function uploadSttFile(asset: UploadInput['asset']): Promise<SttResponse> {
  const asciiPath = await copyToAsciiCachePath(asset.uri, asset.name);
  let jobId: string;
  try {
    const result = await FileSystem.uploadAsync(`${API_HOST}/api/stt`, asciiPath, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: asset.mimeType ?? inferAudioMime(asset.name),
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    });
    jobId = parseApiEnvelope<SttJobCreated>(result.status, result.body).jobId;
  } finally {
    await FileSystem.deleteAsync(asciiPath, { idempotent: true }).catch(() => undefined);
  }
  return pollSttJob(jobId);
}

export async function uploadAudio(
  input: UploadInput,
  onStage?: (s: Stage) => void,
): Promise<RecordingFile> {
  onStage?.('stt');
  const stt = await uploadSttFile(input.asset);

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
  const stt = await uploadSttFile(asset);

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

// 서버 src/_common/chunk.ts 와 동일한 슬라이딩 윈도우 규칙. 텍스트 모드는 STT 를 건너뛰어
// 클라이언트에서 청크를 만든 뒤 그대로 /embed 로 보낸다.
const TEXT_CHUNK_SIZE = 1000;
const TEXT_CHUNK_OVERLAP = 150;

function splitTextIntoChunks(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= TEXT_CHUNK_SIZE) return [trimmed];

  const chunks: string[] = [];
  const step = TEXT_CHUNK_SIZE - TEXT_CHUNK_OVERLAP;
  for (let start = 0; start < trimmed.length; start += step) {
    const end = Math.min(start + TEXT_CHUNK_SIZE, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end === trimmed.length) break;
  }
  return chunks;
}

type TextUploadInput = {
  name: string;
  text: string;
};

/**
 * 텍스트 입력으로 새 녹음을 생성. STT 를 건너뛰고 클라이언트에서 청크 → /embed → 로컬 저장.
 */
export async function uploadText(
  input: TextUploadInput,
  onStage?: (s: Stage) => void,
): Promise<RecordingFile> {
  const transcript = input.text.trim();
  if (!transcript) throw new Error('empty_text');
  const chunks = splitTextIntoChunks(transcript);
  if (chunks.length === 0) throw new Error('empty_text');

  onStage?.('embed');
  const embed = await apiPostJson<EmbedResponse>('/embed', { texts: chunks } satisfies EmbedBody);

  if (embed.vectors.length !== chunks.length) {
    throw new Error('embed_count_mismatch');
  }

  onStage?.('saving');
  const id = newRecordingId();
  const createdAt = new Date().toISOString();
  const recChunks: RecordingChunk[] = chunks.map((text, idx) => ({
    index: idx,
    text,
    embedding: embed.vectors[idx],
  }));
  const rec: RecordingFile = {
    id,
    name: input.name.trim() || 'untitled',
    createdAt,
    transcript,
    chunks: recChunks,
  };
  await writeRecording(rec);
  return rec;
}

/**
 * 기존 녹음에 텍스트를 이어붙임. STT 단계 없이 청크 → /embed → append 로 처리.
 */
export async function appendText(
  existingId: string,
  text: string,
  onStage?: (s: Stage) => void,
): Promise<RecordingFile> {
  const transcript = text.trim();
  if (!transcript) throw new Error('empty_text');
  const chunks = splitTextIntoChunks(transcript);
  if (chunks.length === 0) throw new Error('empty_text');

  onStage?.('embed');
  const embed = await apiPostJson<EmbedResponse>('/embed', { texts: chunks } satisfies EmbedBody);

  if (embed.vectors.length !== chunks.length) {
    throw new Error('embed_count_mismatch');
  }

  onStage?.('saving');
  const updated = await appendToRecording(existingId, transcript, chunks, embed.vectors);
  if (!updated) {
    throw new Error('recording_not_found');
  }
  return updated;
}
