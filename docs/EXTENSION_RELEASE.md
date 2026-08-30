# Browser extension — release checklist

Pre-flight for publishing `apps/extension` to the Chrome Web Store (not done yet — this is the
list to walk when we decide to).

## Manifest & assets
- [ ] `version` bumped in `public/manifest.json` (semver; store rejects reuse)
- [ ] Icons: 16/32/48/128 px (`icons` field is currently ABSENT — required for the store)
- [ ] `name` / `description` ≤ 132 chars, no superlatives (store policy)
- [ ] Screenshots 1280×800 (side panel + options page, light & dark)

## Permission justifications (store review form)
- `webNavigation` — hostname-only navigation shape (never full URLs)
- `webRequest` — opt-in traffic *shape* (host · status · latency); listeners detach without consent
- `storage` — consent + optional runtime token; `storage.session` for hidden-since
- `sidePanel` — the body
- `host_permissions <all_urls>` — hardest to justify; consider narrowing or the activeTab model
  if review pushes back

## Privacy disclosures
- [ ] Single-purpose description: "adapts a local workspace to your behavior"
- [ ] Data usage: no content collected; hostnames/counters sent ONLY to localhost (user-run
  runtime); nothing to remote servers; no sale/transfer
- [ ] Privacy policy URL (repo `docs/` page is acceptable)

## Hard blockers to fix before store review
- [ ] `sidepanel.html`/`options.html` reference `http://localhost:3000` — fine for dev builds;
  a store build should degrade gracefully when no runtime exists (offline hint already does)
- [ ] Decide the update story for `RUNTIME`/session constants (currently hard-coded)

## Verification
- [ ] `pnpm --filter @particle/extension build` → load `dist/` clean on a fresh profile
- [ ] All four consent combinations behave (network listeners attach/detach)
- [ ] `extension.spec.ts` + `options.spec.ts` green against a live runtime
