param(
  [string]$BaseUrl = "http://127.0.0.1:43121",
  [string]$EnrollmentCode = "654321"
)

$health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
if ($health.status -ne "ok" -or $health.database -ne "ready") {
  throw "Edge hub health check failed."
}

$pairBody = @{
  deviceId = "smoke-terminal"
  deviceName = "Smoke terminal"
  enrollmentCode = $EnrollmentCode
} | ConvertTo-Json
$pairing = Invoke-RestMethod -Uri "$BaseUrl/v1/pair" -Method Post -ContentType "application/json" -Body $pairBody
if (-not $pairing.deviceToken) {
  throw "Pairing did not return a device token."
}

$headers = @{ "X-GiroMesa-Device-Token" = $pairing.deviceToken }
$commandId = [Guid]::NewGuid().ToString()
$command = @{
  id = $commandId
  organizationId = [Guid]::NewGuid().ToString()
  unitId = [Guid]::NewGuid().ToString()
  actorId = [Guid]::NewGuid().ToString()
  deviceId = "smoke-terminal"
  type = "order.created"
  payload = @{ orderId = "smoke-order" }
  version = 1
  occurredAt = [DateTimeOffset]::UtcNow.ToString("O")
} | ConvertTo-Json -Depth 5

$first = Invoke-RestMethod -Uri "$BaseUrl/v1/commands" -Method Post -Headers $headers -ContentType "application/json" -Body $command
$second = Invoke-RestMethod -Uri "$BaseUrl/v1/commands" -Method Post -Headers $headers -ContentType "application/json" -Body $command
if ($first.duplicate -or -not $second.duplicate) {
  throw "Idempotency check failed."
}

Write-Host "Edge hub smoke passed: health, pairing, durable command and duplicate replay."
