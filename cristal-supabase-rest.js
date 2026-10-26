/**
 * Shared Supabase REST helpers for Cristal (index.html + inventory board).
 * Publishable keys (sb_publishable_*) must use apikey only — not Authorization: Bearer.
 */
(function (global) {
  function buildSupabaseHeaders(apiKey, opts) {
    opts = opts || {};
    var headers = { apikey: apiKey };
    if (opts.contentType) headers['Content-Type'] = opts.contentType;
    if (opts.prefer) headers.Prefer = opts.prefer;
    // Legacy JWT anon/service_role keys only.
    if (apiKey && apiKey.indexOf('eyJ') === 0) {
      headers.Authorization = 'Bearer ' + apiKey;
    }
    return headers;
  }

  function getEnv() {
    var url = (global.CRISTAL_SUPABASE_URL || '').replace(/\/$/, '');
    var key = global.CRISTAL_SUPABASE_ANON_KEY || '';
    if (!url || !key) return null;
    return { url: url, key: key };
  }

  function supabaseFetch(path, options) {
    var env = getEnv();
    if (!env) return Promise.reject(new Error('No Supabase env'));
    var headers = buildSupabaseHeaders(env.key, { contentType: 'application/json' });
    if (options && options.body !== undefined && options.preferMerge !== false) {
      headers.Prefer = 'resolution=merge-duplicates';
    }
    if (options && options.preferMerge === false) {
      delete headers.Prefer;
    }
    if (options && options.prefer) {
      headers.Prefer = options.prefer;
    }
    return fetch(env.url + '/rest/v1' + path, {
      method: (options && options.method) || 'GET',
      headers: headers,
      body: options && options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  }

  /** Reliable upsert for production_data rows (PATCH if exists, else POST). */
  function saveProductionDataRow(rowKey, value) {
    var env = getEnv();
    if (!env) return Promise.reject(new Error('No Supabase env'));
    var keyEq = '/rest/v1/production_data?key=eq.' + encodeURIComponent(rowKey);
    return fetch(env.url + keyEq + '&select=key', { headers: buildSupabaseHeaders(env.key) })
      .then(function (probe) {
        if (!probe.ok) {
          return probe.text().then(function (t) {
            throw new Error('Supabase read failed (' + probe.status + '): ' + (t || probe.statusText));
          });
        }
        return probe.json();
      })
      .then(function (existing) {
        var hasRow = Array.isArray(existing) && existing.length > 0;
        if (hasRow) {
          return fetch(env.url + keyEq, {
            method: 'PATCH',
            headers: buildSupabaseHeaders(env.key, { contentType: 'application/json' }),
            body: JSON.stringify({ value: value }),
          });
        }
        return fetch(env.url + '/rest/v1/production_data', {
          method: 'POST',
          headers: buildSupabaseHeaders(env.key, { contentType: 'application/json' }),
          body: JSON.stringify([{ key: rowKey, value: value }]),
        }).then(function (res) {
          if (res.status === 409) {
            return fetch(env.url + keyEq, {
              method: 'PATCH',
              headers: buildSupabaseHeaders(env.key, { contentType: 'application/json' }),
              body: JSON.stringify({ value: value }),
            });
          }
          return res;
        });
      })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error('Supabase save failed (' + res.status + '): ' + (t || res.statusText));
          });
        }
        return res;
      });
  }

  global.cristalBuildSupabaseHeaders = buildSupabaseHeaders;
  global.cristalSupabaseFetch = supabaseFetch;
  global.cristalSaveProductionDataRow = saveProductionDataRow;
})(typeof window !== 'undefined' ? window : globalThis);
