import { supabase } from './supabase.js';

// Subscribes to postgres_changes on the given tables and invokes
// onChange(table, payload) whenever a row is inserted/updated/deleted.
// Returns an unsubscribe function — callers MUST invoke it when the
// consuming page/view is torn down to avoid leaking channels.
export function subscribeRealtime(tables, onChange) {
  const channelName = `pos-rt-${tables.join('-')}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase.channel(channelName);

  tables.forEach((table) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      try {
        onChange(table, payload);
      } catch {
        /* ignore listener errors so one bad handler doesn't break the channel */
      }
    });
  });

  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
