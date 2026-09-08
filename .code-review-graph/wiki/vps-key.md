# vps-key

## Overview

Directory-based community: deploy/vps

- **Size**: 12 nodes
- **Cohesion**: 0.0143
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
| read_env_key | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh | 44-58 |
| release_disk_gate | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh | 60-128 |
| recover_mutators | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh | 408-477 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `docker` (25 edge(s))
- `return` (23 edge(s))
- `echo` (22 edge(s))
- `isinstance` (18 edge(s))
- `get` (13 edge(s))
- `true` (7 edge(s))
- `sleep` (7 edge(s))
- `bool` (7 edge(s))
- `python3` (5 edge(s))
- `seq` (5 edge(s))
- `break` (5 edge(s))
- `"${recovery_compose[@]}"` (5 edge(s))
- `"${current_compose[@]}"` (4 edge(s))
- `ln` (3 edge(s))
- `continue` (3 edge(s))

### Incoming

- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/deploy-pilot.sh` (12 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/rollback-app.sh` (5 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/preserve-legacy-providers.sh` (4 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/ensure-cloudflare-dns.sh` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/validate-buildkit-attestations.py` (3 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/deploy/vps/provision-ingress.sh` (1 edge(s))
