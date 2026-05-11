/** 회의록 텍스트를 임베딩 단위로 분할. 한국어 기준 단순 슬라이딩 윈도우. */
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

export function splitIntoChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= CHUNK_SIZE) return [trimmed];

  const chunks: string[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0; start < trimmed.length; start += step) {
    const end = Math.min(start + CHUNK_SIZE, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end === trimmed.length) break;
  }
  return chunks;
}

/** 코사인 유사도. 길이가 다르면 -Infinity 반환 (정렬 시 자연스럽게 밀림). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -Infinity;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -Infinity;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
