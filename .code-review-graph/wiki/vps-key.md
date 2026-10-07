# vps-key

## Overview

Directory-based community: deploy/vps

- **Size**: 21 nodes
- **Cohesion**: 0.0397
- **Dominant Language**: bash

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| read_env | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/backup-to-r2.py | 24-38 |
| run | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/backup-to-r2.py | 41-45 |
| aws | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/backup-to-r2.py | 48-59 |
| prune_scheduled | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/backup-to-r2.py | 62-86 |
| main | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/backup-to-r2.py | 89-194 |
| read_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh | 20-38 |
| require_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh | 40-49 |
| write_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh | 51-58 |
| read_env_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh | 44-58 |
| release_disk_gate | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh | 60-128 |
| recover_mutators | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh | 408-477 |
| read_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/ensure-cloudflare-dns.sh | 7-16 |
| read_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/preserve-legacy-providers.sh | 20-36 |
| write_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/preserve-legacy-providers.sh | 38-43 |
| rollback | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/provision-ingress.sh | 31-38 |
| read_env_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/rollback-app.sh | 35-49 |
| restore_previous_release | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/rollback-app.sh | 151-208 |
| recover_previous_release | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/rollback-app.sh | 211-219 |
| views | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/validate-buildkit-attestations.py | 6-13 |
| valid | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/validate-buildkit-attestations.py | 16-57 |
| cleanup_attestation_stage | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/verify-image-provenance.sh | 30-30 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `return` (25 edge(s))
- `docker` (25 edge(s))
- `echo` (23 edge(s))
- `RuntimeError` (21 edge(s))
- `get` (20 edge(s))
- `isinstance` (20 edge(s))
- `loads` (9 edge(s))
- `true` (9 edge(s))
- `fullmatch` (7 edge(s))
- `sleep` (7 edge(s))
- `bool` (7 edge(s))
- `str` (6 edge(s))
- `printf` (6 edge(s))
- `read_text` (5 edge(s))
- `is_symlink` (5 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh` (93 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh` (12 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/backup-to-r2.py` (6 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/rollback-app.sh` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/preserve-legacy-providers.sh` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/ensure-cloudflare-dns.sh` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/validate-buildkit-attestations.py` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/provision-ingress.sh` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/verify-image-provenance.sh` (1 edge(s))
