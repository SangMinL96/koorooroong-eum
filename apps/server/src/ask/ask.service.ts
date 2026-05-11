import { Injectable } from '@nestjs/common';
import type { AskBody, AskContext, AskResponse, AskSource } from '@koorooroong-eum/shared-types';
import { LlmService } from '../_common/llm/llm.service';

@Injectable()
export class AskService {
  constructor(private readonly llm: LlmService) {}

  async ask(body: AskBody): Promise<AskResponse> {
    const question = body.question?.trim();
    if (!question) {
      return { answer: '', sources: [] };
    }
    const contexts = Array.isArray(body.contexts) ? body.contexts : [];
    if (contexts.length === 0) {
      return {
        answer: '저장된 녹음이 없거나 관련 내용을 찾지 못했습니다.',
        sources: [],
      };
    }

    const contextBlock = contexts
      .map((c: AskContext, i: number) => {
        const src = c.source;
        return `[자료 ${i + 1} | ${src.recordingName} · chunk #${src.chunkIndex}]\n${c.text}`;
      })
      .join('\n\n');

    const systemPrompt = [
      '너는 사용자가 핸드폰에 저장해 둔 녹음 자료를 기반으로 한국어 질문에 답하는 어시스턴트다.',
      '아래 [녹음 자료] 안의 내용만 근거로 답변한다.',
      '자료에 없으면 "녹음 자료에서 해당 내용을 찾지 못했습니다."라고 답한다.',
      '추측하지 말고, 가능한 한 구체적으로 답한다.',
      '답변에 인용한 자료는 [자료 N] 형태로 본문에 표시한다.',
    ].join(' ');

    const userPrompt = `[녹음 자료]\n${contextBlock}\n\n[질문]\n${question}`;
    const answer = (await this.llm.generateAnswer(systemPrompt, userPrompt)).trim();

    const sources: AskSource[] = contexts.map((c) => c.source);
    return { answer, sources };
  }
}
