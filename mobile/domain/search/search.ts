import type { AskContext } from '@/lib/types';
import { listRecordings, readRecording } from '@/domain/recording/store/fileStore';

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

export interface SearchTopKOptions {
  /** 특정 녹음 1건으로만 검색 범위를 좁힌다. 미지정 시 전체 녹음 검색. */
  recordingId?: string;
}

export type Relevance = 'high' | 'medium' | 'low';

/** 녹음 단위 검색 결과 — 녹음의 청크 중 가장 유사도가 높은 청크 정보를 함께 반환. */
export interface RecordingHit {
  recordingId: string;
  recordingName: string;
  /** 최종 점수 (의미 유사도 + 키워드 부스트, 0~1) — 정렬/필터/라벨링 기준 */
  score: number;
  /** 키워드 부스트 적용 전 순수 의미 유사도 (0~1) */
  semanticScore: number;
  /** 'high' | 'medium' | 'low' — 사용자에게 보여줄 관련도 라벨 */
  relevance: Relevance;
  /** 질의 토큰이 최고 청크 텍스트에 직접 포함되어 있는지 */
  keywordMatched: boolean;
  /** 가장 유사도가 높은 청크의 인덱스 */
  topChunkIndex: number;
  /** 가장 유사도가 높은 청크 텍스트 (스니펫용) */
  topChunkText: string;
  /** minChunkScore 이상인 청크 개수 (관련도 신호용) */
  matchedChunkCount: number;
  /** 녹음 생성 시각 (ISO) */
  createdAt: string;
}

export interface SearchRecordingsOptions {
  /** 결과 개수 상한 (기본 10) */
  topN?: number;
  /** matchedChunkCount 계산용 임계값 (기본 0.4) */
  minChunkScore?: number;
  /** 결과에 포함시킬 최종 점수 하한 (기본 medium 임계값=0.6).
   *  단, 키워드가 직접 매치된 녹음은 이 값 미만이어도 통과한다. */
  minScore?: number;
  /** 하이브리드 검색용 원본 질의 — 토큰이 청크 텍스트에 포함되면 점수 부스팅 */
  query?: string;
  /** 키워드 매치 시 가산할 부스트 (기본 0.15) */
  keywordBoost?: number;
}

const HIGH_THRESHOLD = 0.75;
const MEDIUM_THRESHOLD = 0.6;

/** 한국어 임베딩 분포상 0.6 미만은 약한 의미 매칭으로 본다. */
export function relevanceLabel(score: number): Relevance {
  if (score >= HIGH_THRESHOLD) return 'high';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

/**
 * 질의 문자열을 키워드 매칭용 토큰으로 분해.
 * - 공백으로 분리한 2글자 이상 토큰
 * - 원문 전체도 별도 토큰으로 포함 (다어절 구문 매칭용)
 */
function tokenizeQuery(q: string): string[] {
  const trimmed = q.trim().toLowerCase();
  if (!trimmed) return [];
  const tokens = new Set<string>();
  for (const part of trimmed.split(/\s+/)) {
    if (part.length >= 2) tokens.add(part);
  }
  if (trimmed.length >= 2) tokens.add(trimmed);
  return [...tokens];
}

/**
 * 저장된 녹음의 청크와 질의 벡터 간 코사인 유사도를 계산해 Top-K 컨텍스트를 반환한다.
 * - 저장 녹음이 0건이면 빈 배열 반환.
 * - opts.recordingId 지정 시 해당 녹음의 청크만 대상으로 한다.
 */
export async function searchTopK(
  queryVec: number[],
  k = 5,
  opts: SearchTopKOptions = {},
): Promise<AskContext[]> {
  const metas = await listRecordings();
  const targets = opts.recordingId
    ? metas.filter((m) => m.id === opts.recordingId)
    : metas;
  if (targets.length === 0) return [];

  const all: { score: number; ctx: AskContext }[] = [];
  for (const meta of targets) {
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

/**
 * 질의 벡터와 모든 저장 녹음의 청크 유사도를 계산해 녹음 단위로 집계한 랭킹을 반환한다.
 * - 녹음 점수 = 해당 녹음의 청크 중 최고 유사도
 * - matchedChunkCount = minChunkScore 이상인 청크 개수
 */
export async function searchRecordings(
  queryVec: number[],
  opts: SearchRecordingsOptions = {},
): Promise<RecordingHit[]> {
  const topN = opts.topN ?? 10;
  const minChunkScore = opts.minChunkScore ?? 0.4;
  const minScore = opts.minScore ?? MEDIUM_THRESHOLD;
  const keywordBoost = opts.keywordBoost ?? 0.15;
  const tokens = opts.query ? tokenizeQuery(opts.query) : [];

  const metas = await listRecordings();
  if (metas.length === 0) return [];

  const hits: RecordingHit[] = [];
  for (const meta of metas) {
    const rec = await readRecording(meta.id);
    if (!rec || rec.chunks.length === 0) continue;

    let bestFinal = -Infinity;
    let bestSemantic = 0;
    let bestIndex = 0;
    let bestText = '';
    let bestKeywordHit = false;
    let matched = 0;
    for (const chunk of rec.chunks) {
      const semantic = cosineSimilarity(queryVec, chunk.embedding);
      const chunkLower = tokens.length > 0 ? chunk.text.toLowerCase() : '';
      const keywordHit = tokens.length > 0 && tokens.some((t) => chunkLower.includes(t));
      // 부스트 적용 후에도 1을 넘기지 않도록 클램프 — 라벨링 일관성 유지.
      const final = Math.min(1, semantic + (keywordHit ? keywordBoost : 0));
      if (final > bestFinal) {
        bestFinal = final;
        bestSemantic = semantic;
        bestIndex = chunk.index;
        bestText = chunk.text;
        bestKeywordHit = keywordHit;
      }
      if (semantic >= minChunkScore || keywordHit) matched++;
    }
    // medium 이상이거나 키워드가 본문에 직접 매치된 경우만 결과로 포함.
    if (bestFinal < minScore && !bestKeywordHit) continue;
    hits.push({
      recordingId: rec.id,
      recordingName: rec.name,
      score: bestFinal,
      semanticScore: bestSemantic,
      relevance: relevanceLabel(bestFinal),
      keywordMatched: bestKeywordHit,
      topChunkIndex: bestIndex,
      topChunkText: bestText,
      matchedChunkCount: matched,
      createdAt: rec.createdAt,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topN);
}
