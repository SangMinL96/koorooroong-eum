import type { AskContext } from '@koorooroong-eum/shared-types';
import { listRecordings } from '../recording/store/fileStore';
import { readRecording } from '../recording/store/fileStore';

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 모든 저장된 녹음의 청크와 질의 벡터 간 코사인 유사도를 계산해 Top-K 컨텍스트를 반환한다.
 * - 저장 녹음이 0건이면 빈 배열 반환.
 */
export async function searchTopK(queryVec: number[], k = 5): Promise<AskContext[]> {
  const metas = await listRecordings();
  if (metas.length === 0) return [];

  const all: { score: number; ctx: AskContext }[] = [];
  for (const meta of metas) {
    const rec = await readRecording(meta.id);
    if (!rec) continue;
    for (const chunk of rec.chunks) {
      const score = cosineSimilarity(queryVec, chunk.embedding);
      all.push({
        score,
        ctx: {
          text: chunk.text,
          source: {
            recordingId: rec.id,
            recordingName: rec.name,
            chunkIndex: chunk.index,
            score,
          },
        },
      });
    }
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, k).map((x) => x.ctx);
}
