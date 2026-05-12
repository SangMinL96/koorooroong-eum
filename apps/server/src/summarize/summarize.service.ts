import { BadRequestException, Injectable } from '@nestjs/common';
import type { GroundingSource, SummarizeBody, SummarizeResponse } from '@koorooroong-eum/shared-types';
import { LlmService } from '../_common/llm/llm.service';

const MAX_TEXT_CHARS = 60_000;
const MAX_GROUNDING_SOURCES = 6;

@Injectable()
export class SummarizeService {
  constructor(private readonly llm: LlmService) {}

  async summarize(body: SummarizeBody): Promise<SummarizeResponse> {
    const text = body.text?.trim();
    if (!text) {
      throw new BadRequestException('text required');
    }
    const clipped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
    const name = body.recordingName?.trim();

    const systemPrompt = [
      '너는 사용자의 녹취 전사 텍스트를 한국어로 간결하게 요약하는 어시스턴트다.',
      '입력은 음성 인식 결과이므로 어색한 표현/오인식이 있을 수 있다. 의미 단위로 자연스럽게 정리한다.',
      '',
      '[출력 형식] — 반드시 GitHub Flavored Markdown 형식으로 작성한다.',
      '- 각 섹션은 `##` 헤더로 시작한다.',
      '- 목록은 `-` 불렛으로, 강조는 `**굵게**`로 표현한다.',
      '- 코드/식별자/고유명사는 백틱(`` ` ``)으로 감싼다.',
      '- 답변에 코드 블록 펜스(```) 를 감싸 마크다운 자체를 출력하지 않는다 — 마크다운 문서를 그대로 내보낸다.',
      '',
      '아래 5개 섹션을 순서대로 작성한다.',
      '## 핵심 요약 — 회의 전체 내용을 1~2문장으로 요약.',
      '## 주요 논제 — 논의된 주요 주제별 핵심 내용을 불렛포인트로 요약.',
      '## 결정 및 의문점 — 확정된 사항과 추가 확인(Follow-up)이 필요한 질문/의문점 분류 (두 개의 소제목 `### 결정사항`, `### 의문점`).',
      '## 최종 결론 — 회의의 최종 합의안 또는 핵심 성과 요약.',
      '## 추천 검색어 — 본문에서 언급된 기술/개념/고유명사 중 사용자가 더 찾아볼 만한 검색어 (최대 3개).',
      '  - **URL/링크는 절대로 생성하지 않는다.** 너는 실시간 웹 검색 도구가 없으므로 URL을 만들어내면 잘못된 정보가 된다.',
      '  - 형식: `` - `"검색어"` — 한 줄 설명 ``',
      '  - 본문에서 다룬 적이 없는 일반 검색어는 넣지 않는다.',
      '',
      '주의: 본문에 언급되지 않은 내용은 절대로 추측하여 작성하지 않는다.',
    ].join('\n');

    const userPrompt = [
      name ? `[녹음 제목] ${name}` : null,
      '[전사 텍스트]',
      clipped,
    ]
      .filter(Boolean)
      .join('\n');

    const { text: rawAnswer, groundingChunks } = await this.llm.generateGroundedAnswer(systemPrompt, userPrompt);
    const summary = rawAnswer.trim();

    const seen = new Set<string>();
    const groundingSources: GroundingSource[] = [];
    for (const chunk of groundingChunks) {
      const web = chunk.web;
      if (!web?.uri || seen.has(web.uri)) continue;
      seen.add(web.uri);
      groundingSources.push({ uri: web.uri, title: web.title, domain: web.domain });
      if (groundingSources.length >= MAX_GROUNDING_SOURCES) break;
    }

    return groundingSources.length > 0 ? { summary, groundingSources } : { summary };
  }
}
