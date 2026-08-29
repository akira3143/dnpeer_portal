# DN42 Portal Data Directory (`server/data/`)

> [!IMPORTANT]
> **Production & Runtime Data Notice**
> 
> The JSON files in this directory (`auth_users.json`, `peering_sessions.json`, `port_ledger.json`, `registry_cache.json`) contain persistent runtime, authentication, and peering state data.
> 
> **STRICT RULE FOR AUTOMATED TESTS & SCRIPTS:**
> - Automated tests (unit, integration, and E2E) MUST ALWAYS use isolated temporary directories via `process.env.PORTAL_DATA_DIR` (`os.tmpdir()/dn42-test-*`).
> - Automated scripts and tests **MUST NEVER** delete, wipe, overwrite, or mutate the persistent files inside this directory.
> - Any cleanup of runtime production data must only be performed manually by the administrator.
