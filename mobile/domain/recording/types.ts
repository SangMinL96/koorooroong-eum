import type { GroundingSource } from '@/lib/types';

export interface RecordingChunk {
  index: number;
  text: string;
  /** 768-dim embedding from text-embedding-004 */
  embedding: number[];
}

export interface RecordingFile {
  id: string;
  name: string;
  /** ISO datetime string */
  createdAt: string;
  /** 전체 전사 텍스트 (줄바꿈 포함) */
  transcript: string;
  chunks: RecordingChunk[];
  /** Gemini 요약 결과. 캐시되어 다음 진입 시 재호출 없이 사용. */
  summary?: string;
  /** 요약 생성 시각 (ISO). */
  summaryAt?: string;
  /** Google Search Grounding으로 인용된 외부 출처 (있을 때만). */
  summarySources?: GroundingSource[];
}

export interface RecordingMeta {
  id: string;
  name: string;
  createdAt: string;
  chunkCount: number;
}

export interface RecordingIndex {
  version: 1;
  recordings: RecordingMeta[];
}
