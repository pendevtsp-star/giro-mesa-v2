#!/usr/bin/env bash
set -Eeuo pipefail

target=${1:-/srv/apps/giromesa-v2/shared/.env}
if [[ ! -f $target ]]; then
  echo "RUNTIME_ENV_NOT_FOUND" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "RUNTIME_ENV_TOOL_REQUIRED:python3" >&2
  exit 1
fi

python3 - "$target" <<'PY'
import base64, json, os, pathlib, re, secrets, stat, sys, tempfile

target = pathlib.Path(sys.argv[1])
text = target.read_text(encoding="utf-8")
lines = text.splitlines()
entry = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
values = {}
duplicates = set()
obsolete_names = {
    "COOKIE_DOMAIN",
    "CUSTOMER_QA_DEMO_SLUG",
    "NEXT_PUBLIC_DEMO_HUB_ACK",
    "VITE_DEMO_MODE",
}
for line in lines:
    match = entry.match(line)
    if match:
        if match.group(1) in values:
            duplicates.add(match.group(1))
            continue
        raw = match.group(2).strip()
        if len(raw) >= 2 and raw[0] == raw[-1] == '"':
            try:
                raw = json.loads(raw)
            except Exception:
                print(f"RUNTIME_ENV_VALUE_INVALID:{match.group(1)}", file=sys.stderr)
                raise SystemExit(1)
        values[match.group(1)] = raw
if duplicates:
    print(f"RUNTIME_ENV_DUPLICATE_KEY:{sorted(duplicates)[0]}", file=sys.stderr)
    raise SystemExit(1)

def valid_key(value, exact=False):
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception:
        return False
    return len(decoded) == 32 if exact else len(decoded) >= 32

permissions = {
    "platform.read",
    "platform.pii.read",
    "platform.action.propose",
    "platform.action.approve",
    "platform.action.reject",
    "platform.tenant.suspend",
    "platform.tenant.restore",
    "platform.membership.disable",
    "platform.membership.restore",
    "platform.incident.transition",
}
email_pattern = re.compile(r"^[^@\s=;,:]+@[^@\s=;,:]+\.[^@\s=;,:]+$")
roles = {"viewer", "support", "finance", "fiscal", "engineering", "admin"}

def valid_roles(value):
    if not value or "\n" in value or "\r" in value:
        return False
    for assignment in value.split(","):
        separator = "=" if "=" in assignment else ":"
        if assignment.count(separator) != 1:
            return False
        email, role = assignment.split(separator, 1)
        if not email_pattern.fullmatch(email.strip()) or role.strip() not in roles:
            return False
    return True

def valid_grants(value):
    if not value or "\n" in value or "\r" in value:
        return False
    for grant in value.split(";"):
        if grant.count("=") != 1:
            return False
        email, raw_permissions = grant.split("=", 1)
        requested = raw_permissions.split("|")
        if not email_pattern.fullmatch(email.strip()) or not requested:
            return False
        if any(permission.strip() not in permissions for permission in requested):
            return False
    return True

additions = {}
configured_roles = values.get("PLATFORM_ADMIN_ROLES")
if configured_roles is None:
    configured_roles = os.environ.get("PLATFORM_ADMIN_ROLES_BOOTSTRAP", "")
    if configured_roles:
        additions["PLATFORM_ADMIN_ROLES"] = configured_roles
if configured_roles and not valid_roles(configured_roles):
    print("PLATFORM_ADMIN_ROLES_INVALID", file=sys.stderr)
    raise SystemExit(1)

grants = values.get("PLATFORM_ADMIN_GRANTS")
if grants is None:
    grants = os.environ.get("PLATFORM_ADMIN_GRANTS_BOOTSTRAP", "")
    if grants:
        additions["PLATFORM_ADMIN_GRANTS"] = grants
if grants and not valid_grants(grants):
    print("PLATFORM_ADMIN_GRANTS_INVALID", file=sys.stderr)
    raise SystemExit(1)

active = values.get("COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION")
serialized = values.get("COMMAND_FINGERPRINT_KEYS")
if active is not None and not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", active):
    print("COMMAND_FINGERPRINT_KEY_VERSION_INVALID", file=sys.stderr)
    raise SystemExit(1)
keyring = None
if serialized is not None:
    try:
        keyring = json.loads(serialized)
    except Exception:
        keyring = None
    if not isinstance(keyring, dict) or not keyring or any(
        not isinstance(version, str)
        or not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", version)
        or not isinstance(value, str)
        or not valid_key(value)
        for version, value in keyring.items()
    ):
        print("COMMAND_FINGERPRINT_KEYRING_INVALID", file=sys.stderr)
        raise SystemExit(1)
if active is None and keyring is None:
    active = "v1"
    keyring = {active: base64.b64encode(secrets.token_bytes(32)).decode()}
    additions["COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION"] = active
    additions["COMMAND_FINGERPRINT_KEYS"] = json.dumps(keyring, separators=(",", ":"))
elif active is not None and keyring is None:
    keyring = {active: base64.b64encode(secrets.token_bytes(32)).decode()}
    additions["COMMAND_FINGERPRINT_KEYS"] = json.dumps(keyring, separators=(",", ":"))
elif active is None and keyring is not None:
    if len(keyring) != 1:
        print("COMMAND_FINGERPRINT_ACTIVE_KEY_REQUIRED", file=sys.stderr)
        raise SystemExit(1)
    active = next(iter(keyring))
    additions["COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION"] = active
elif active not in keyring:
    print("COMMAND_FINGERPRINT_ACTIVE_KEY_UNAVAILABLE", file=sys.stderr)
    raise SystemExit(1)

for name, exact in (
    ("FISCAL_CREDENTIALS_ENCRYPTION_KEY", True),
    ("PRIVACY_EXPORT_ENCRYPTION_KEY", True),
    ("PUBLIC_TABLE_SESSION_SIGNING_KEY", False),
    ("GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64", False),
    ("GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64", True),
):
    value = values.get(name)
    if value is None:
        additions[name] = base64.b64encode(secrets.token_bytes(32)).decode()
    elif not valid_key(value, exact=exact):
        print(f"{name}_INVALID", file=sys.stderr)
        raise SystemExit(1)

qr_table_token_secret = values.get("QR_TABLE_TOKEN_SECRET")
if qr_table_token_secret is None:
    additions["QR_TABLE_TOKEN_SECRET"] = secrets.token_hex(32)
elif len(qr_table_token_secret.strip()) < 32:
    print("QR_TABLE_TOKEN_SECRET_INVALID", file=sys.stderr)
    raise SystemExit(1)

runtime_defaults = {
    "MEDIA_ROOT": "/app/data/media",
    "EDGE_HUB_INSTALLER_HOST_PATH": "/srv/apps/giromesa-v2/shared/edge-hub-installer",
    "EDGE_HUB_WINDOWS_INSTALLER_PATH": "/app/data/edge-hub-installer/GiroMesa-Conector-Setup.exe",
    "EDGE_HUB_WINDOWS_INSTALLER_CHANNEL": "pilot",
    "EDGE_HUB_WINDOWS_INSTALLER_VERSION": "",
    "EDGE_HUB_WINDOWS_INSTALLER_SHA256": "",
    "EDGE_HUB_PILOT_ORGANIZATION_IDS": "",
    "SMARTPOS_SIGNATURE_MAX_SKEW_SECONDS": "300",
    "NEXT_PUBLIC_REDE_STORE_URL": "",
    "NEXT_PUBLIC_PAYGO_STORE_URL": "",
    "NEXT_PUBLIC_STONE_STORE_URL": "",
    "REPORT_EMAIL_DELIVERY_HOMOLOGATED": "false",
}
for name, default in runtime_defaults.items():
    if name not in values:
        additions[name] = default
if values.get("MEDIA_ROOT", "/app/data/media") != "/app/data/media":
    print("MEDIA_ROOT_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("EDGE_HUB_INSTALLER_HOST_PATH", "/srv/apps/giromesa-v2/shared/edge-hub-installer") != "/srv/apps/giromesa-v2/shared/edge-hub-installer":
    print("EDGE_HUB_INSTALLER_HOST_PATH_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("EDGE_HUB_WINDOWS_INSTALLER_PATH", "/app/data/edge-hub-installer/GiroMesa-Conector-Setup.exe") != "/app/data/edge-hub-installer/GiroMesa-Conector-Setup.exe":
    print("EDGE_HUB_WINDOWS_INSTALLER_PATH_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("EDGE_HUB_WINDOWS_INSTALLER_CHANNEL", "pilot") not in {"pilot", "stable"}:
    print("EDGE_HUB_WINDOWS_INSTALLER_CHANNEL_INVALID", file=sys.stderr)
    raise SystemExit(1)
installer_sha256 = values.get("EDGE_HUB_WINDOWS_INSTALLER_SHA256", "")
if installer_sha256 and not re.fullmatch(r"[a-fA-F0-9]{64}", installer_sha256):
    print("EDGE_HUB_WINDOWS_INSTALLER_SHA256_INVALID", file=sys.stderr)
    raise SystemExit(1)
installer_version = values.get("EDGE_HUB_WINDOWS_INSTALLER_VERSION", "").strip()
installer_organizations = values.get("EDGE_HUB_PILOT_ORGANIZATION_IDS", "").strip()
installer_enabled = bool(installer_version or installer_sha256 or installer_organizations)
if installer_enabled and (not installer_version or not installer_sha256):
    print("EDGE_HUB_INSTALLER_METADATA_INCOMPLETE", file=sys.stderr)
    raise SystemExit(1)
if installer_enabled and values.get("EDGE_HUB_WINDOWS_INSTALLER_CHANNEL", "pilot") == "pilot" and not installer_organizations:
    print("EDGE_HUB_PILOT_ORGANIZATION_IDS_REQUIRED", file=sys.stderr)
    raise SystemExit(1)
smartpos_skew = values.get("SMARTPOS_SIGNATURE_MAX_SKEW_SECONDS", "300")
if not smartpos_skew.isascii() or not smartpos_skew.isdigit() or not 30 <= int(smartpos_skew) <= 900:
    print("SMARTPOS_SIGNATURE_MAX_SKEW_SECONDS_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("REPORT_EMAIL_DELIVERY_HOMOLOGATED", "false") not in {"true", "false"}:
    print("REPORT_EMAIL_DELIVERY_HOMOLOGATED_INVALID", file=sys.stderr)
    raise SystemExit(1)

if "FOCUS_NFE_PRIMARY_TOKEN" not in values:
    additions["FOCUS_NFE_PRIMARY_TOKEN"] = ""
release_environment = values.get("FISCAL_RELEASE_ENV")
if release_environment is None:
    additions["FISCAL_RELEASE_ENV"] = "homologation"
elif release_environment not in {"homologation", "production"}:
    print("FISCAL_RELEASE_ENV_INVALID", file=sys.stderr)
    raise SystemExit(1)
timeout = values.get("FOCUS_NFE_TIMEOUT_MS")
if timeout is None:
    additions["FOCUS_NFE_TIMEOUT_MS"] = "15000"
elif not timeout.isascii() or not timeout.isdigit() or not 1000 <= int(timeout) <= 30000:
    print("FOCUS_NFE_TIMEOUT_MS_INVALID", file=sys.stderr)
    raise SystemExit(1)

scanner_defaults = {
    "ACCOUNTANT_ATTACHMENT_SCAN_MODE": "clamd",
    "ACCOUNTANT_ATTACHMENT_CLAMD_HOST": "clamav",
    "ACCOUNTANT_ATTACHMENT_CLAMD_PORT": "3310",
    "ACCOUNTANT_ATTACHMENT_SCAN_TIMEOUT_MS": "10000",
    "ACCOUNTANT_ATTACHMENT_RETENTION_DAYS": "1827",
}

evolution_defaults = {
    "WHATSAPP_PROVIDER_ENABLED": "false",
    "WHATSAPP_PROVIDER_CREDENTIAL_REFERENCE": "evolution-go",
    "WHATSAPP_EVOLUTION_API_URL": "http://evolution-go:4000",
    "WHATSAPP_EVOLUTION_WEBHOOK_URL": "http://api:3200/v1/growth/evolution-go/webhook",
    "EVOLUTION_POSTGRES_USER": "evolution",
    "EVOLUTION_OPERATOR_EMAIL": "",
}
for name, default in evolution_defaults.items():
    if name not in values:
        additions[name] = default
for name in ("WHATSAPP_EVOLUTION_GLOBAL_API_KEY", "WHATSAPP_EVOLUTION_TOKEN_SECRET"):
    value = values.get(name)
    if value is None:
        additions[name] = secrets.token_hex(32)
    elif len(value.strip()) < 32:
        print(f"{name}_INVALID", file=sys.stderr)
        raise SystemExit(1)
if "EVOLUTION_POSTGRES_PASSWORD" not in values:
    additions["EVOLUTION_POSTGRES_PASSWORD"] = secrets.token_hex(24)
elif len(values["EVOLUTION_POSTGRES_PASSWORD"].strip()) < 24:
    print("EVOLUTION_POSTGRES_PASSWORD_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("WHATSAPP_PROVIDER_ENABLED", "false") not in {"true", "false"}:
    print("WHATSAPP_PROVIDER_ENABLED_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("WHATSAPP_PROVIDER_CREDENTIAL_REFERENCE", "evolution-go") != "evolution-go":
    print("WHATSAPP_PROVIDER_CREDENTIAL_REFERENCE_INVALID", file=sys.stderr)
    raise SystemExit(1)

doseclub_defaults = {
    "DOSECLUB_PROVIDER_ENABLED": "false",
    "DOSECLUB_API_BASE_URL": "https://doseclube.giromesa.com.br",
    "DOSECLUB_PROVISIONING_KEY": "",
    "GIROMESA_API_BASE_URL": "https://api.giromesa.com.br",
}
for name, default in doseclub_defaults.items():
    if name not in values:
        additions[name] = default
if "DOSECLUB_CREDENTIAL_SECRET" not in values:
    additions["DOSECLUB_CREDENTIAL_SECRET"] = secrets.token_hex(32)
elif len(values["DOSECLUB_CREDENTIAL_SECRET"].strip()) < 32:
    print("DOSECLUB_CREDENTIAL_SECRET_INVALID", file=sys.stderr)
    raise SystemExit(1)
if values.get("DOSECLUB_PROVIDER_ENABLED", "false") not in {"true", "false"}:
    print("DOSECLUB_PROVIDER_ENABLED_INVALID", file=sys.stderr)
    raise SystemExit(1)
provisioning_key = values.get("DOSECLUB_PROVISIONING_KEY", "").strip()
if values.get("DOSECLUB_PROVIDER_ENABLED") == "true" and len(provisioning_key) < 32:
    print("DOSECLUB_PROVISIONING_KEY_INVALID", file=sys.stderr)
    raise SystemExit(1)
for name, default in scanner_defaults.items():
    if name not in values:
        additions[name] = default
if values.get("ACCOUNTANT_ATTACHMENT_SCAN_MODE", "clamd") != "clamd":
    print("ACCOUNTANT_ATTACHMENT_SCAN_MODE_INVALID", file=sys.stderr)
    raise SystemExit(1)
if not values.get("ACCOUNTANT_ATTACHMENT_CLAMD_HOST", "clamav").strip():
    print("ACCOUNTANT_ATTACHMENT_CLAMD_HOST_INVALID", file=sys.stderr)
    raise SystemExit(1)
for name, minimum, maximum in (
    ("ACCOUNTANT_ATTACHMENT_CLAMD_PORT", 1, 65535),
    ("ACCOUNTANT_ATTACHMENT_SCAN_TIMEOUT_MS", 1000, 30000),
    ("ACCOUNTANT_ATTACHMENT_RETENTION_DAYS", 1827, 36500),
):
    value = values.get(name, scanner_defaults[name])
    if not value.isascii() or not value.isdigit() or not minimum <= int(value) <= maximum:
        print(f"{name}_INVALID", file=sys.stderr)
        raise SystemExit(1)

has_obsolete_names = any(name in values for name in obsolete_names)
if not additions and not has_obsolete_names:
    os.chmod(target, stat.S_IRUSR | stat.S_IWUSR)
    print("Runtime env validado; nenhum segredo foi alterado ou exibido.")
    raise SystemExit(0)

updated = "\n".join(
    line for line in lines if not ((match := entry.match(line)) and match.group(1) in obsolete_names)
)
if updated and not updated.endswith("\n"):
    updated += "\n"
for name, value in additions.items():
    updated += f"{name}={value}\n"

descriptor, temporary_name = tempfile.mkstemp(prefix=f"{target.name}.tmp.", dir=target.parent)
try:
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(updated)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary_name, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(temporary_name, target)
finally:
    if os.path.exists(temporary_name):
        os.unlink(temporary_name)
print("Runtime env endurecido; valores existentes foram preservados e nenhum segredo foi exibido.")
PY
