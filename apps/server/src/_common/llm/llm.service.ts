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

// 무료 티어 RPM 제약을 고려해 동시 5건으로 제한하고 429/일시 오류는 지수 백오프 재시도.
const EMBED_CONCURRENCY = 5;
const EMBED_MAX_RETRIES = 5;
const EMBED_BACKOFF_BASE_MS = 1000;

@Injectable()
export class LlmService implements OnModuleInit {
  private client: GoogleGenAI | null = null;

  constructor(private readonly logger: LoggerService) {}

  onModuleInit() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY 미설정 — LlmService 호출 시 에러가 발생합니다.');
      return;
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  private ensureClient(): GoogleGenAI {
    if (!this.client) {
      throw new Error('GEMINI_API_KEY not set');
    }
    return this.client;
  }

  /**
   * 여러 텍스트를 임베딩한다. 입력 순서와 동일한 순서로 벡터 배열을 반환.
   * batch size 1 제약 → 단건 호출을 동시성 제한으로 병렬 실행.
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    this.ensureClient();

    const total = texts.length;
    const startedAt = Date.now();
    this.logger.log(`임베딩 시작 total=${total} concurrency=${EMBED_CONCURRENCY}`);

    const results: number[][] = new Array(total);
    let nextIndex = 0;
    let completed = 0;

    const worker = async () => {
      for (;;) {
        const i = nextIndex++;
        if (i >= total) return;
        results[i] = await this.embedOneWithRetry(texts[i], i);
        completed++;
        if (completed % 10 === 0 || completed === total) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          this.logger.log(`임베딩 진행 ${completed}/${total} (${elapsed}s)`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, total) }, () => worker()));

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    this.logger.log(`임베딩 완료 total=${total} elapsed=${elapsed}s`);
    return results;
  }

  /** 단일 텍스트 임베딩 헬퍼. */
  async embedText(text: string): Promise<number[]> {
    this.ensureClient();
    return this.embedOneWithRetry(text, 0);
  }

  /** 단건 호출 + 429/일시 오류 지수 백오프. */
  private async embedOneWithRetry(text: string, index: number): Promise<number[]> {
    const client = this.ensureClient();
    let lastErr: unknown;
    for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
      try {
        const res = await client.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: text,
        });
        return res.embeddings?.[0]?.values ?? [];
      } catch (err: unknown) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retriable = /429|RESOURCE_EXHAUSTED|UNAVAILABLE|503|500|deadline/i.test(msg);
        if (!retriable || attempt === EMBED_MAX_RETRIES - 1) break;
        const wait = EMBED_BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
        this.logger.warn(`임베딩 재시도 idx=${index} attempt=${attempt + 1} wait=${wait}ms reason=${msg}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** 시스템 프롬프트 + 사용자 질문으로 답변 생성. */
  async generateAnswer(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = this.ensureClient();
    const res = await client.models.generateContent({
      model: LLM_MODEL,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
      },
    });
    return res.text ?? '';
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
    if (!isSearchGroundingEnabled()) {
      this.logger.log('Search Grounding 비활성화 (ENABLE_SEARCH_GROUNDING=false) — 일반 호출');
      const text = await this.generateAnswer(systemPrompt, userPrompt);
      return { text, groundingChunks: [] };
    }

    const client = this.ensureClient();
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
      const msg = err instanceof Error ? err.message : String(err);
      const quotaIssue = /quota|RESOURCE_EXHAUSTED|429|billing|PERMISSION_DENIED|FAILED_PRECONDITION/i.test(msg);
      if (!quotaIssue) throw err;
      this.logger.warn(`Search Grounding 한도 도달/거부 — grounding 없이 일반 호출로 폴백: ${msg}`);
      const text = await this.generateAnswer(systemPrompt, userPrompt);
      return { text, groundingChunks: [] };
    }
  }
}

function isSearchGroundingEnabled(): boolean {
  const v = process.env.ENABLE_SEARCH_GROUNDING;
  if (v === undefined) return true; // 기본값: 활성 (단, billing 미연결이면 자동 거부됨)
  return v.toLowerCase() !== 'false' && v !== '0';
}
