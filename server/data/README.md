# DN42 Portal Data Directory (`server/data/`)

> [!IMPORTANT]
> **Production & Runtime Data Notice**
> 
> The files in this directory (`auth_users.json`, `peering_sessions.json`, `port_ledger.json`, `node_tokens.json`, `status_cache.json`) contain persistent runtime, authentication, and peering state data.
>
> **DN42 Registry Repository (`server/data/registry/`):**
> - `registry_cache.json` is officially RETIRED as of Round 20.
> - The portal parses objects directly from the local git repository at `server/data/registry/`.
> - Initial production setup requires cloning the repository once:
>   `git clone --depth 1 https://git.dn42.dev/dn42/registry server/data/registry`
> - An in-process background worker syncs the repository every 30 minutes via `git pull`. On login misses, real-time `git pull` is automatically triggered.
> 
> **STRICT RULE FOR AUTOMATED TESTS & SCRIPTS:**
> - Automated tests (unit, integration, and E2E) MUST ALWAYS use isolated temporary directories via `process.env.PORTAL_DATA_DIR` (`os.tmpdir()/dn42-test-*`).
> - Automated scripts and tests **MUST NEVER** delete, wipe, overwrite, or mutate the persistent files inside this directory.
> - Any cleanup of runtime production data must only be performed manually by the administrator.
