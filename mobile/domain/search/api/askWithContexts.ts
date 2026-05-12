import type { AskBody, AskContext, AskResponse } from '@/lib/types';
import { apiPostJson } from '@/lib/api';

export async function askWithContexts(question: string, contexts: AskContext[]): Promise<AskResponse> {
  return apiPostJson<AskResponse>('/ask', { question, contexts } satisfies AskBody);
}
