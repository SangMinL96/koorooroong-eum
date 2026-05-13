import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoogleGenAI, type GroundingChunk } from '@google/genai';
import { LoggerService } from '../logger/logger.service';

export interface GroundedAnswer {
  /** 모델이 생성한 본문 텍스트 */
  text: string;
  /** Google Search로 인용된 출처 chunks (web 정보만). */
  groundingChunks: GroundingChunk[];
}

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const LLM_MODEL = 'gemini-2.5-flash';

// 임베딩은 batch 호출 + 동시성 병렬. RPM 제약 안에서 청크 수가 많아도 빠르게 처리.
const EMBED_BATCH_SIZE = 50;       // gemini-embedding-001은 한 호출당 100까지 가능, 안전 마진 50
const EMBED_CONCURRENCY = 5;        // batch 호출들을 동시 5건 병렬
const EMBED_MAX_RETRIES = 5;
const EMBED_BACKOFF_BASE_MS = 1000;

// LLM(generateContent) 호출은 모델 과부하 시 503 UNAVAILABLE / 500 INTERNAL 이 종종 발생 → 지수 백오프 재시도.
const LLM_MAX_RETRIES = 4;
const LLM_BACKOFF_BASE_MS = 1500;
const LLM_RETRIABLE_RE = /UNAVAILABLE|503|500|INTERNAL|429|RESOURCE_EXHAUSTED|deadline/i;

@Injectable()
export class LlmService implements OnModuleInit {
  /** `::` 로 구분된 여러 API 키. 매 호출마다 랜덤 선택해 quota 분산. */
  private apiKeys: string[] = [];
  /** 키별 GoogleGenAI 인스턴스 캐시 — 매 호출 시 새로 생성하지 않고 재사용. */
  private clientCache = new Map<string, GoogleGenAI>();

  constructor(private readonly logger: LoggerService) {}

  onModuleInit() {
    const raw = process.env.GEMINI_API_KEY;
    if (!raw) {
      this.logger.warn('GEMINI_API_KEY 미설정 — LlmService 호출 시 에러가 발생합니다.');
      return;
    }
    this.apiKeys = raw
      .split('::')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (this.apiKeys.length === 0) {
      this.logger.warn('GEMINI_API_KEY 가 비어 있습니다.');
      return;
    }
    this.logger.log(`Gemini API 키 ${this.apiKeys.length}개 로드 (요청·재시도마다 랜덤 선택)`);
  }

  /**
   * 매 호출 시 랜덤 키를 선택해 해당 키의 client를 반환.
   * - 같은 키에 대한 client 는 캐시되어 재사용
   * - retry 루프 내부에서 매 attempt마다 호출하면 자연스러운 키 로테이션이 됨
   */
  private ensureClient(): GoogleGenAI {
    if (this.apiKeys.length === 0) {
      throw new Error('GEMINI_API_KEY not set');
    }
    const key = this.apiKeys[Math.floor(Math.random() * this.apiKeys.length)];
    let client = this.clientCache.get(key);
    if (!client) {
      client = new GoogleGenAI({ apiKey: key });
      this.clientCache.set(key, client);
    }
    return client;
  }

  /**
   * 여러 텍스트를 임베딩한다. 입력 순서와 동일한 순서로 벡터 배열을 반환.
   * - texts를 EMBED_BATCH_SIZE 단위로 슬라이스 → 각 슬라이스를 1회 호출로 batch 임베딩
   * - batch 호출들은 EMBED_CONCURRENCY 만큼 병렬 실행
   * - **한 embedTexts 호출 안에서는 같은 API 키 사용** (요청 단위 키 일관성).
   *   batch가 몇 개로 나뉘든, retry가 몇 번 일어나든 동일 client 재사용.
   * - 일시 오류는 지수 백오프로 재시도.
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // 요청 시작 시점에 키 1개만 픽 — 이후 모든 batch/retry 가 같은 client 공유
    const client = this.ensureClient();

    const total = texts.length;
    const startedAt = Date.now();

    // 입력을 batch 슬라이스로 쪼개고, 각 슬라이스의 시작 인덱스를 기록 (결과 재배치용)
    const slices: { start: number; texts: string[] }[] = [];
    for (let i = 0; i < total; i += EMBED_BATCH_SIZE) {
      slices.push({ start: i, texts: texts.slice(i, i + EMBED_BATCH_SIZE) });
    }
    this.logger.log(
      `임베딩 시작 total=${total} batchSize=${EMBED_BATCH_SIZE} batches=${slices.length} concurrency=${EMBED_CONCURRENCY}`,
    );

    const results: number[][] = new Array(total);
    let nextBatchIdx = 0;
    let completedBatches = 0;

    const worker = async () => {
      for (;;) {
        const bi = nextBatchIdx++;
        if (bi >= slices.length) return;
        const { start, texts: batchTexts } = slices[bi];
        const vectors = await this.embedBatchOnClient(client, batchTexts, bi);
        for (let j = 0; j < vectors.length; j++) {
          results[start + j] = vectors[j];
        }
        completedBatches++;
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        this.logger.log(`임베딩 batch ${completedBatches}/${slices.length} (+${batchTexts.length}) elapsed=${elapsed}s`);
      }
    };

    await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, slices.length) }, () => worker()));

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    this.logger.log(`임베딩 완료 total=${total} elapsed=${elapsed}s`);
    return results;
  }

  /** 단일 텍스트 임베딩 헬퍼. 요청 단위 키 일관성 유지. */
  async embedText(text: string): Promise<number[]> {
    const client = this.ensureClient();
    const [vec] = await this.embedBatchOnClient(client, [text], 0);
    return vec;
  }

  /**
   * 지정된 client(== 지정된 API 키)로 batch 임베딩 호출 + 일시 오류 지수 백오프.
   * 호출자가 한 요청 안에서 같은 client를 넘기면 키 일관성 보장.
   */
  private async embedBatchOnClient(
    client: GoogleGenAI,
    batchTexts: string[],
    batchIdx: number,
  ): Promise<number[][]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
      try {
        const res = await client.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: batchTexts,
        });
        const embeddings = res.embeddings ?? [];
        if (embeddings.length !== batchTexts.length) {
          throw new Error(`embed_count_mismatch expected=${batchTexts.length} got=${embeddings.length}`);
        }
        return embeddings.map((e) => e.values ?? []);
      } catch (err: unknown) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retriable = /429|RESOURCE_EXHAUSTED|UNAVAILABLE|503|500|deadline/i.test(msg);
        if (!retriable || attempt === EMBED_MAX_RETRIES - 1) break;
        const wait = EMBED_BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
        this.logger.warn(`임베딩 batch 재시도 batch=${batchIdx} attempt=${attempt + 1} wait=${wait}ms reason=${msg.slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * 시스템 프롬프트 + 사용자 질문으로 답변 생성.
   * 503/500/429 등 일시 오류는 지수 백오프로 재시도.
   * **한 호출 안에서는 같은 API 키 사용** (재시도해도 동일 client).
   */
  async generateAnswer(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = this.ensureClient();
    return this.generateAnswerOnClient(client, systemPrompt, userPrompt);
  }

  /** 지정된 client(== 지정된 API 키)로 답변 생성 + 재시도. */
  private async generateAnswerOnClient(
    client: GoogleGenAI,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
      try {
        const res = await client.models.generateContent({
          model: LLM_MODEL,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.2,
          },
        });
        return res.text ?? '';
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retriable = LLM_RETRIABLE_RE.test(msg);
        if (!retriable || attempt === LLM_MAX_RETRIES - 1) break;
        const wait = LLM_BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 500);
        this.logger.warn(`LLM(generateAnswer) 재시도 attempt=${attempt + 1}/${LLM_MAX_RETRIES} wait=${wait}ms reason=${msg.slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * Google Search Grounding을 활성화해 답변 생성.
   * - 모델이 자동으로 웹 검색을 수행하고 그 결과를 기반으로 답변한다.
   * - 응답의 groundingMetadata.groundingChunks 에 실제 출처 URL/제목이 들어온다.
   *
   * [과금 안전장치]
   * - 환경변수 `ENABLE_SEARCH_GROUNDING=false` 이면 grounding을 시도조차 하지 않고 일반 호출로 폴백.
   * - quota/billing 관련 에러(429 등)가 발생하면 자동으로 grounding 없이 재시도.
   * - 두 경우 모두 Search Grounding 과금 0건 보장.
   */
  async generateGroundedAnswer(systemPrompt: string, userPrompt: string): Promise<GroundedAnswer> {
    // 한 호출 안에서는 같은 client(== 같은 API 키)를 grounding 시도 + retry + fallback 모두 공유.
    const client = this.ensureClient();

    if (!isSearchGroundingEnabled()) {
      this.logger.log('Search Grounding 비활성화 (ENABLE_SEARCH_GROUNDING=false) — 일반 호출');
      const text = await this.generateAnswerOnClient(client, systemPrompt, userPrompt);
      return { text, groundingChunks: [] };
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
      try {
        const res = await client.models.generateContent({
          model: LLM_MODEL,
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.2,
            tools: [{ googleSearch: {} }],
          },
        });
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        return { text: res.text ?? '', groundingChunks: chunks };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);

        // 1) quota/billing/권한 거부 → 즉시 grounding 끄고 일반 호출로 폴백 (재시도해도 같은 결과).
        const quotaIssue = /quota|billing|PERMISSION_DENIED|FAILED_PRECONDITION/i.test(msg);
        if (quotaIssue) {
          this.logger.warn(`Search Grounding 거부 — grounding 없이 일반 호출로 폴백 (같은 client 유지): ${msg.slice(0, 200)}`);
          const text = await this.generateAnswerOnClient(client, systemPrompt, userPrompt);
          return { text, groundingChunks: [] };
        }

        // 2) 일시적 모델 과부하(503/500/429) → 지수 백오프 재시도.
        const retriable = LLM_RETRIABLE_RE.test(msg);
        if (retriable && attempt < LLM_MAX_RETRIES - 1) {
          const wait = LLM_BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 500);
          this.logger.warn(`LLM(generateGroundedAnswer) 재시도 attempt=${attempt + 1}/${LLM_MAX_RETRIES} wait=${wait}ms reason=${msg.slice(0, 200)}`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }

        // 3) 끝까지 retriable 503 등 → 마지막 보루로 grounding 없이 일반 호출 시도 (그것 또한 retry 보호됨).
        if (retriable) {
          this.logger.warn(`Search Grounding 재시도 소진 — grounding 없이 일반 호출로 폴백 (같은 client 유지): ${msg.slice(0, 200)}`);
          try {
            const text = await this.generateAnswerOnClient(client, systemPrompt, userPrompt);
            return { text, groundingChunks: [] };
          } catch (fallbackErr) {
            throw fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
          }
        }

        // 4) 위 어느 분기에도 안 걸리면 그대로 throw
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

function isSearchGroundingEnabled(): boolean {
  const v = process.env.ENABLE_SEARCH_GROUNDING;
  if (v === undefined) return true; // 기본값: 활성 (단, billing 미연결이면 자동 거부됨)
  return v.toLowerCase() !== 'false' && v !== '0';
}
