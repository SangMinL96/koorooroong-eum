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
