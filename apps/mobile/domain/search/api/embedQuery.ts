import type { EmbedBody, EmbedResponse } from '@koorooroong-eum/shared-types';
import { apiPostJson } from '@/lib/api';

export async function embedQuery(query: string): Promise<number[]> {
  const res = await apiPostJson<EmbedResponse>('/embed', { texts: [query] } satisfies EmbedBody);
  if (!res.vectors[0]) {
    throw new Error('embed_no_vector');
  }
  return res.vectors[0];
}
