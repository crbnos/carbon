---
paths: []
triggers: []
promoted: null
---
# Two hooks that open the same Realtime topic close each other's channel

**Context:** The shell, the live lists and individual components each called `carbon.channel(topic)` for `company:<id>:<table>`.

**Problem:** `RealtimeClient.channel()` returns the EXISTING channel when the topic is already open. Two hooks then hold one channel object, and the first to unmount calls `removeChannel` and silences the other. A customers page that declared `customer` while the customer list also followed it would have lost one of them at random.

**Rule:** One owner per topic. Listeners register in the registry in `packages/query/src/useRealtime.tsx` (`useTopic`, `useTableChanges`) and `RouteRealtime` owns the channels. Do not call `carbon.channel` or `useRealtimeChannel` for a broadcast topic directly.

**Applies to:** `packages/query/src/useRealtime.tsx`, any new realtime listener.
