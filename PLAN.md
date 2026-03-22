# Snag App — Performance Plan (v2)

## Root Cause Diagnosis

The first pass fixed symptoms. The app is still slow because of **three structural problems** that weren't addressed:

---

### Problem 1 — Every screen independently re-fetches auth + profile (the biggest culprit)

`App.tsx` fetches the user's profile once and stores it in local state. But it only passes `userRole` to the navigator. Every screen that needs `userId`, `orgId`, or the full profile must do its own round-trips:

| Screen | Extra queries on mount |
|---|---|
| `navigation/index.tsx` `fetchOpenCount` | `auth.getUser()` + `profiles.select(organisation_id)` + `issues.count` = **3 queries** on every app-resume |
| `IssueListScreen` | none (but query has no explicit `org_id` filter — relies on RLS subquery) |
| `IssueDetailScreen` | `auth.getUser()` + `getProfile()` + `getUserVote()` + `getOrgMembers()` = **4 queries** on mount |
| `ReportIssueScreen` `handleSubmit` | `auth.getUser()` + `profiles.select(organisation_id)` = **2 queries on every submit** |
| `LeaderboardScreen` | `auth.getUser()` + `profiles.select(organisation_id)` = **2 queries on mount** |
| `AdminDashboardScreen` | `auth.getUser()` + `getProfile()` + `getOrgMembers()` = **3 queries on mount** |

**Fix:** Create a `UserProfileContext` that makes `session`, `profile`, `userId`, and `orgId` available to every component without re-fetching.

---

### Problem 2 — App startup blocks on `getProfile` before rendering anything

`App.tsx` line 43–46:
```ts
} else if (session && event !== 'TOKEN_REFRESHED') {
  const p = await getProfile(session.user.id);  // ← blocks everything
  setProfile(p);
  setLoading(false);                            // ← UI only unlocks after this
}
```

The user sees a blank spinner for the full `getProfile` network round-trip (~200–600ms on a mobile connection) before the navigation tree even mounts. Meanwhile Supabase already persists the session in AsyncStorage — we know the user is authenticated immediately.

**Fix:** Mount the navigation tree straight away using cached session data; load the profile concurrently in the background. Use `expo-splash-screen` to hold the native splash (invisible to user) until the first meaningful paint is ready.

---

### Problem 3 — `issues_with_details` view does a GROUP BY join on every query, without the org filter hitting the index

The view:
```sql
select i.*, p.name, a.name, count(c.id) as comment_count
from issues i
left join profiles p ...
left join profiles a ...
left join comments c ...
group by i.id, p.name, p.avatar_url, a.name, a.avatar_url
```

`IssueListScreen` queries this view with no explicit `organisation_id` filter. The filter comes from the RLS policy, which runs a subquery (`select organisation_id from profiles where id = auth.uid()`) on **every row** evaluated. This defeats the composite index `(organisation_id, created_at)` added in the previous pass.

Additionally, the view has no vote aggregation — `vote_score`, `upvote_count`, `downvote_count` are always `null` because the `votes` table is never joined.

**Fix:** Add explicit `.eq('organisation_id', orgId)` to IssueListScreen (using context for orgId), update the view to aggregate votes, and add an RLS optimisation function.

---

## Plan

### Step 1 — Create `UserProfileContext`
**New file:** `src/context/UserProfileContext.tsx`

Provides `{ session, profile, userId, orgId, isLoading }` to the entire component tree. `App.tsx` becomes the single source of truth; all screens read from context instead of querying Supabase.

**Files changed:** `src/context/UserProfileContext.tsx` (new), `App.tsx`

---

### Step 2 — Fix app startup: non-blocking profile load + `expo-splash-screen`

Instead of gating the entire UI on `getProfile`, split startup into two phases:

1. **Phase 1 (sync):** Read the cached session from AsyncStorage. If a session exists, mount the navigation tree immediately and show a skeleton/loading indicator *inside* the authenticated screen (not a full-screen blocker).
2. **Phase 2 (async, parallel):** Fetch the profile in the background. Context consumers update reactively when it arrives.

Install `expo-splash-screen` to keep the native splash visible until the navigation container is ready (replaces the manual `ActivityIndicator` that currently shows for 200–600ms).

**Files changed:** `App.tsx`, `package.json`

---

### Step 3 — Remove all per-screen auth/profile re-fetches

Replace every `supabase.auth.getUser()` + `profiles.select` call in screens with a `useUserProfile()` hook that reads from context.

| File | Current | After |
|---|---|---|
| `navigation/index.tsx` `fetchOpenCount` | 3 queries (getUser + profile + count) | 1 query (count only, orgId from context) |
| `IssueDetailScreen` `useEffect` | 4 queries | 2 queries (issue + vote, profile/orgId from context) |
| `ReportIssueScreen` `handleSubmit` | 2 queries | 0 queries (userId + orgId from context) |
| `LeaderboardScreen` `useEffect` | 2 queries | 0 queries (orgId from context) |
| `AdminDashboardScreen` `useEffect` | 3 queries | 1 query (orgId from context) |

**Files changed:** `navigation/index.tsx`, `IssueDetailScreen.tsx`, `ReportIssueScreen.tsx`, `LeaderboardScreen.tsx`, `AdminDashboardScreen.tsx`

---

### Step 4 — Add explicit `org_id` filter to list queries

Once screens have `orgId` from context, add `.eq('organisation_id', orgId)` to the `issues_with_details` query in `IssueListScreen`. This lets Postgres use the composite index `(organisation_id, created_at desc)` directly rather than filtering via the RLS subquery on every row.

**Files changed:** `IssueListScreen.tsx`

---

### Step 5 — Fix `issues_with_details` view: add vote aggregation + RLS optimisation

**Update the view** to join on the `votes` table and aggregate `vote_score`, `upvote_count`, `downvote_count`. Currently these are always `null`.

**Add an RLS security definer helper** to avoid the repeated `profiles` subquery per row:
```sql
create or replace function auth_organisation_id()
returns uuid language sql stable security definer
as $$ select organisation_id from profiles where id = auth.uid() $$;
```
Then update RLS policies to call `auth_organisation_id()` instead of the inline subquery. This is evaluated once per query, not once per row.

**Output:** New SQL migration file `supabase/migration_view_votes_rls.sql`

---

### Step 6 — Fix photo upload race condition

In `ReportIssueScreen`, `compressAndUpload` is called **without `await`** from `pickFromLibrary` and `takePhoto`:
```ts
compressAndUpload(uri);  // ← not awaited, setUploadTask called async
```
If the user taps Submit before `setUploadTask` is called, `handleSubmit` falls through to uploading the **uncompressed original** (line 120):
```ts
photoUrl = await uploadIssuePhoto(photoUri, `${Date.now()}.jpg`);
// ← photoUri is the raw camera URI, compression bypassed
```

**Fix:** Store the upload promise in a `useRef` (set synchronously before async work starts) and make `compressAndUpload` return its promise so the ref is assigned before any await.

**Files changed:** `ReportIssueScreen.tsx`

---

### Step 7 — `getOrgMembers` call in `IssueDetailScreen` (only needed for admins/managers)

`getOrgMembers` fetches all org member profiles on every issue detail open — but this data is only used for the "Manage Issue" assignee picker, which is only shown to admins/managers (`canEdit`). Workers load this data unnecessarily.

**Fix:** Gate the `getOrgMembers` call behind `profile.role === 'admin' || 'manager'`.

**Files changed:** `IssueDetailScreen.tsx`

---

## Summary of Changes

| # | What | Impact | Files |
|---|---|---|---|
| 1 | `UserProfileContext` — single source of truth for session/profile | Eliminates ~10 duplicate Supabase queries across screens | New file + App.tsx |
| 2 | Non-blocking startup + `expo-splash-screen` | Removes 200–600ms blank spinner before first paint | App.tsx |
| 3 | Remove per-screen auth re-fetches (use context) | Removes 1–3 round-trips per screen mount | 5 screen files |
| 4 | Explicit `org_id` filter on issue list query | Index hit directly instead of via RLS row-by-row | IssueListScreen |
| 5 | Fix `issues_with_details` + RLS optimisation | Votes work correctly; RLS runs once per query not per row | New SQL migration |
| 6 | Fix photo upload race condition | Compression always applied, no uncompressed fallback | ReportIssueScreen |
| 7 | Gate `getOrgMembers` to admins/managers only | Removes unnecessary fetch for ~80% of users | IssueDetailScreen |

## Package changes
- `expo-splash-screen` — already part of Expo SDK, just needs `expo install expo-splash-screen`

## SQL Migration required
Run `supabase/migration_view_votes_rls.sql` in Supabase → SQL Editor after code is deployed.
