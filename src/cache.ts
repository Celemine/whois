export interface CacheEntry {
  data: unknown;
  negative?: boolean;
}

export async function cacheGet(
  key: string,
  kv: KVNamespace
): Promise<CacheEntry | null> {
  const raw = await kv.get(key, "text");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  entry: CacheEntry,
  kv: KVNamespace,
  ttlSeconds: number
): Promise<void> {
  await kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds });
}
