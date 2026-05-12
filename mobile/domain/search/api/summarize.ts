import type { SummarizeBody, SummarizeResponse } from '@/lib/types';
import { apiPostJson } from '@/lib/api';

export async function summarizeText(
  text: string,
  recordingName?: string,
): Promise<SummarizeResponse> {
  return apiPostJson<SummarizeResponse>('/summarize', {
    text,
    recordingName,
  } satisfies SummarizeBody);
}
