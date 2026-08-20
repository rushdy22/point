import { createClient } from '@supabase/supabase-js';

// Same Supabase project as before — used for Auth (which must eventually
// reach the network to sign in) and as the fallback data client when not
// running inside Electron (e.g. `npm run dev` in a plain browser tab).
const SUPABASE_URL = 'https://eaxdtyoozszfshnjmwdj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_uzqItu5rD5MGEOYAXioEfA_Z5Qg_Fzn';

const realClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'pes-auth-session'
  }
});

const hasLocalDb = typeof window !== 'undefined' && !!window.electronAPI?.db?.exec;

// A minimal, chainable stand-in for supabase-js's PostgrestFilterBuilder,
// covering exactly the methods this project uses (see grep audit). Every
// call just records intent on a plain descriptor object; awaiting the
// builder (it implements `.then()`) sends that descriptor once, over IPC,
// to the Electron main process, which executes it against local SQLite
// (electron/db/queryEngine.js) and returns the same { data, error } shape
// the real Supabase client would — so every existing lib/db/*.js query
// file keeps working completely unchanged.
class LocalQueryBuilder {
  constructor(table) {
    this.desc = { table, action: 'select', filters: [] };
  }
  select(str) { this.desc.selectStr = str; return this; }
  eq(col, val) { this.desc.filters.push({ col, op: 'eq', val }); return this; }
  neq(col, val) { this.desc.filters.push({ col, op: 'neq', val }); return this; }
  gte(col, val) { this.desc.filters.push({ col, op: 'gte', val }); return this; }
  lte(col, val) { this.desc.filters.push({ col, op: 'lte', val }); return this; }
  gt(col, val) { this.desc.filters.push({ col, op: 'gt', val }); return this; }
  lt(col, val) { this.desc.filters.push({ col, op: 'lt', val }); return this; }
  in(col, arr) { this.desc.filters.push({ col, op: 'in', val: arr }); return this; }
  ilike(col, val) { this.desc.filters.push({ col, op: 'ilike', val }); return this; }
  or(str) { this.desc.orClause = str; return this; }
  order(col, opts) { this.desc.order = { col, ascending: opts?.ascending !== false, nullsFirst: opts?.nullsFirst }; return this; }
  limit(n) { this.desc.limit = n; return this; }
  single() { this.desc.single = true; return this; }
  maybeSingle() { this.desc.maybeSingle = true; return this; }
  insert(payload) { this.desc.action = 'insert'; this.desc.payload = payload; return this; }
  update(payload) { this.desc.action = 'update'; this.desc.payload = payload; return this; }
  upsert(payload, opts) { this.desc.action = 'upsert'; this.desc.payload = payload; this.desc.upsertConflict = opts?.onConflict; return this; }
  delete() { this.desc.action = 'delete'; return this; }

  then(resolve, reject) {
    window.electronAPI.db.exec(this.desc).then(resolve, reject);
  }
}

export const supabase = {
  auth: realClient.auth,
  channel: (...args) => realClient.channel(...args),
  removeChannel: (...args) => realClient.removeChannel(...args),
  from(table) {
    return hasLocalDb ? new LocalQueryBuilder(table) : realClient.from(table);
  }
};

// exported for the rare case (sync engine bootstrap, diagnostics) something
// needs the untouched network client directly.
export const supabaseRemote = realClient;
