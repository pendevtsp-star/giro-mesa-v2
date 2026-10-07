# scripts-validate

## Overview

Directory-based community: scripts

- **Size**: 168 nodes
- **Cohesion**: 0.1547
- **Dominant Language**: javascript

## Members

| Name | Kind | File | Lines |
|------|------|------|-------|
| cleanup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-production.sh | 189-200 |
| run | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore-linux.integration.test.mjs | 23-35 |
| waitForPostgres | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore-linux.integration.test.mjs | 37-44 |
| test:Linux backup and restore round-trip database, objects, encrypted config and smoke@L46 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore-linux.integration.test.mjs | 46-346 |
| path | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore-linux.integration.test.mjs | 65-65 |
| shellPath | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.integration.test.mjs | 23-23 |
| run | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.integration.test.mjs | 25-37 |
| waitForPostgres | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.integration.test.mjs | 39-48 |
| test:round-trips PostgreSQL, objects and encrypted configuration before a functional smoke@L50 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.integration.test.mjs | 50-366 |
| powershell | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 26-36 |
| output | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 38-40 |
| backupArgs | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 42-62 |
| restoreArgs | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 64-84 |
| crc32 | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 86-95 |
| createStoredZip | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 97-137 |
| writeSignedBackup | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 139-194 |
| addFile | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 141-149 |
| test:backup fails closed before invoking PostgreSQL when the manifest key is absent@L196 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 196-208 |
| test:backup rejects a reparse point inside the object tree before invoking PostgreSQL@L210 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 210-231 |
| test:backup rejects a reparse point used as the encrypted configuration archive@L233 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 233-252 |
| test:restore rejects a forged manifest before touching the target@L254 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 254-270 |
| test:restore rejects a signed privileged database role before touching the target@L272 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 272-297 |
| test:restore rejects a reparse point used as the backup directory@L299 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 299-317 |
| test:restore rejects ZIP traversal before invoking PostgreSQL or extracting files@L319 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 319-342 |
| test:restore rejects a symbolic-link entry in the ZIP before invoking PostgreSQL@L344 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 344-366 |
| test:restore rejects a reparse-point object target before invoking PostgreSQL@L368 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 368-392 |
| test:restore refuses an existing reparse point at restore-evidence.json@L394 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 394-413 |
| test:restore validates source and target release identities independently@L415 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 415-441 |
| test@L424 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 424-439 |
| test:PowerShell DR scripts bind security controls and the source-target release contract@L443 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/backup-restore.test.mjs | 443-475 |
| isRecord | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 14-14 |
| hasText | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 15-15 |
| immutableReference | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 16-18 |
| validEncryptionKey | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 20-29 |
| validateFiscalReleaseManifest | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 31-91 |
| validateFiscalEnvironment | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 93-132 |
| nonEmpty | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 134-140 |
| validateRecoveryCoverage | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 142-147 |
| checkFiscalRelease | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 149-183 |
| read | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 153-153 |
| main | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.mjs | 185-193 |
| digest | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 24-24 |
| test:accepts the fail-closed fiscal manifest outside production@L53 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 53-57 |
| test:blocks production until complete external evidence exists@L59 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 59-68 |
| test:accepts production only with homologation evidence and valid secret configuration@L70 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 70-73 |
| test:rejects retention shorter than the five-year fiscal policy@L75 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 75-83 |
| test:rejects malformed fiscal encryption keys before release@L85 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 85-93 |
| test:requires recovery evidence for the latest migration in every release mode@L95 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 95-104 |
| test:current repository passes the declared non-production fiscal gate@L106 | Test | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-release.test.mjs | 106-109 |
| mount_source | Function | C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/check-fiscal-storage.sh | 19-21 |

*... and 118 more members.*

## Execution Flows

No execution flows pass through this community.

## Dependencies

### Outgoing

- `match` (300 edge(s))
- `join` (137 edge(s))
- `push` (91 edge(s))
- `equal` (85 edge(s))
- `readFileSync` (79 edge(s))
- `doesNotMatch` (41 edge(s))
- `deepEqual` (38 edge(s))
- `writeFileSync` (36 edge(s))
- `repeat` (29 edge(s))
- `notEqual` (28 edge(s))
- `mkdtempSync` (27 edge(s))
- `tmpdir` (27 edge(s))
- `toString` (27 edge(s))
- `ok` (27 edge(s))
- `rmSync` (27 edge(s))

### Incoming

- `match` (291 edge(s))
- `join` (123 edge(s))
- `equal` (83 edge(s))
- `readFileSync` (78 edge(s))
- `doesNotMatch` (41 edge(s))
- `C:/Users/maxue/projetos_programação/giro_mesa_v2/scripts/deploy-hardening.test.mjs` (39 edge(s))
- `deepEqual` (38 edge(s))
- `writeFileSync` (33 edge(s))
- `notEqual` (28 edge(s))
- `mkdtempSync` (27 edge(s))
- `tmpdir` (27 edge(s))
- `repeat` (27 edge(s))
- `ok` (27 edge(s))
- `rmSync` (27 edge(s))
- `toString` (23 edge(s))
