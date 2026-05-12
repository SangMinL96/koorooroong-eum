const host = process.env.EXPO_PUBLIC_API_HOST;

if (!host) {
  // eslint-disable-next-line no-console
  console.warn('[env] EXPO_PUBLIC_API_HOST is not set. Defaulting to http://10.18.1.38:4100');
}

export const API_HOST = host ?? 'http://10.18.1.38:4100';
