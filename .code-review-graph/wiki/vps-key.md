# vps-key

## Overview

Directory-based community: deploy/vps

- **Size**: 15 nodes
- **Cohesion**: 0.0145
- **Dominant Language**: bash

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
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
| read_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh | 20-38 |
| require_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh | 40-49 |
| write_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh | 51-58 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `isinstance` (18 edge(s))
- `get` (13 edge(s))
- `return` (8 edge(s))
- `docker` (8 edge(s))
- `bool` (7 edge(s))
- `true` (6 edge(s))
- `printf` (6 edge(s))
- `echo` (6 edge(s))
- `"${current_compose[@]}"` (4 edge(s))
- `grep` (3 edge(s))
- `sleep` (3 edge(s))
- `shift` (2 edge(s))
- `exit` (2 edge(s))
- `ln` (2 edge(s))
- `python3` (2 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/bootstrap-env.sh` (92 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/rollback-app.sh` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/preserve-legacy-providers.sh` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/ensure-cloudflare-dns.sh` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/validate-buildkit-attestations.py` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/provision-ingress.sh` (1 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/verify-image-provenance.sh` (1 edge(s))
