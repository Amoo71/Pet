// Built-in GIF / sticker search. GIPHY and Tenor both require a (free) API key;
// the key is stored only in this browser (localStorage) and sent only to that provider.

const LS = 'tendies.gifsearch';

export function getSearchSettings() {
  try {
    return { provider: 'giphy', giphyKey: '', tenorKey: '', rating: 'pg-13', ...JSON.parse(localStorage.getItem(LS) || '{}') };
  } catch {
    return { provider: 'giphy', giphyKey: '', tenorKey: '', rating: 'pg-13' };
  }
}

export function setSearchSettings(s) {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export const PROVIDERS = {
  giphy: { name: 'GIPHY', keyUrl: 'https://developers.giphy.com/dashboard/', attribution: 'Powered by GIPHY' },
  tenor: { name: 'Tenor', keyUrl: 'https://developers.google.com/tenor/guides/quickstart', attribution: 'Via Tenor' },
};

/**
 * @returns {Promise<{items:{id,title,preview,url,w,h}[], next:string|null}>}
 */
export async function searchGifs(query, { stickers = false, offset = 0, next = null, signal } = {}) {
  const s = getSearchSettings();
  const q = encodeURIComponent(query.trim());
  if (s.provider === 'tenor') {
    if (!s.tenorKey) throw new Error('Add a Tenor API key in Settings.');
    const url = `https://tenor.googleapis.com/v2/${q ? 'search' : 'featured'}?key=${encodeURIComponent(s.tenorKey)}&client_key=tendies_studio&limit=24&media_filter=gif,tinygif${q ? `&q=${q}` : ''}${stickers ? '&searchfilter=sticker' : ''}&contentfilter=${s.rating === 'g' ? 'high' : 'medium'}${next ? `&pos=${encodeURIComponent(next)}` : ''}`;
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(`Tenor error ${r.status}`);
    const j = await r.json();
    return {
      items: (j.results || []).map((x) => ({
        id: x.id,
        title: x.content_description || x.title || 'GIF',
        preview: x.media_formats?.tinygif?.url,
        url: x.media_formats?.gif?.url,
        w: x.media_formats?.gif?.dims?.[0],
        h: x.media_formats?.gif?.dims?.[1],
      })),
      next: j.next || null,
    };
  }
  if (!s.giphyKey) throw new Error('Add a GIPHY API key in Settings.');
  const kind = stickers ? 'stickers' : 'gifs';
  const url = `https://api.giphy.com/v1/${kind}/${q ? 'search' : 'trending'}?api_key=${encodeURIComponent(s.giphyKey)}&limit=24&offset=${offset}&rating=${s.rating}${q ? `&q=${q}` : ''}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`GIPHY error ${r.status}`);
  const j = await r.json();
  return {
    items: (j.data || []).map((x) => ({
      id: x.id,
      title: x.title || 'GIF',
      preview: x.images?.fixed_width_small?.url || x.images?.fixed_width?.url,
      url: x.images?.downsized_medium?.url || x.images?.original?.url,
      w: Number(x.images?.original?.width),
      h: Number(x.images?.original?.height),
    })),
    next: j.pagination && j.pagination.offset + j.pagination.count < j.pagination.total_count ? String(j.pagination.offset + j.pagination.count) : null,
  };
}
