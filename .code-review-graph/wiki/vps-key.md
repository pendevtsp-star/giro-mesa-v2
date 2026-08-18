# vps-key

## Overview

Directory-based community: deploy/vps

- **Size**: 7 nodes
- **Cohesion**: 0.0110
- **Dominant Language**: bash

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| read_key | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\ensure-cloudflare-dns.sh | 7-16 |
| read_key | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\preserve-legacy-providers.sh | 20-36 |
| write_key | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\preserve-legacy-providers.sh | 38-43 |
| rollback | Function | C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\provision-ingress.sh | 31-38 |

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `true` (3 edge(s))
- `printf` (3 edge(s))
- `grep` (2 edge(s))
- `return` (2 edge(s))
- `continue` (1 edge(s))
- `unlink` (1 edge(s))
- `ln` (1 edge(s))
- `nginx` (1 edge(s))
- `systemctl` (1 edge(s))

### Incoming

- `C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\preserve-legacy-providers.sh` (4 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\ensure-cloudflare-dns.sh` (3 edge(s))
- `C:\Users\maxue\projetos_programação\giro_mesa_v2\deploy\vps\provision-ingress.sh` (1 edge(s))
