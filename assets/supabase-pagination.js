(function exposeSupabasePagination(global) {
  async function fetchAllPages(fetchPage, pageSize = 1000) {
    if (typeof fetchPage !== 'function' || !Number.isInteger(pageSize) || pageSize < 1) {
      throw new TypeError('fetchAllPages requires a page function and positive integer page size');
    }
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await fetchPage(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!Array.isArray(data)) throw new TypeError('paged Supabase query returned no row array');
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  }

  function fetchAllRows(client, table, filterColumn, filterValue, options = {}) {
    const pageSize = options.pageSize ?? 1000;
    const orderBy = options.orderBy ?? 'created_at';
    const tieBreaker = options.tieBreaker ?? 'id';
    return fetchAllPages((from, to) => {
      let query = client.from(table).select(options.columns ?? '*').eq(filterColumn, filterValue);
      if (orderBy) query = query.order(orderBy, { ascending: options.ascending !== false });
      if (tieBreaker && tieBreaker !== orderBy) query = query.order(tieBreaker, { ascending: options.ascending !== false });
      return query.range(from, to);
    }, pageSize);
  }

  global.ZamSupabasePagination = Object.freeze({ fetchAllPages, fetchAllRows });
})(typeof window !== 'undefined' ? window : globalThis);
