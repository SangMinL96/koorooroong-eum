import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { LoggerService } from '../logger/logger.service';

export const EMBEDDING_MODEL = 'text-embedding-004';
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
}
