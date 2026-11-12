/** In-memory socket presence (one Express process — plan Step 14). */
const online = new Map<string, Set<string>>();

export const presence = {
  add(accountId: string, socketId: string) {
    const set = online.get(accountId) || new Set<string>();
    set.add(socketId);
    online.set(accountId, set);
  },
  remove(accountId: string, socketId: string) {
    const set = online.get(accountId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) online.delete(accountId);
  },
  isOnline(accountId: string) {
    return (online.get(accountId)?.size || 0) > 0;
  },
  listOnlineIds() {
    return [...online.keys()];
  },
};
