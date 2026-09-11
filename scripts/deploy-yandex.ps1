param(
  [Parameter(Mandatory = $true)]
  [string]$VmHost,
  [string]$RemoteUser = 'yc-user',
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\darts-yandex-v4",
  [string]$PublicUrl = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseStamp = Get-Date -Format 'yyyyMMddHHmmss'
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "dart-scorekeeper-$releaseStamp.tgz"
$remoteArchive = "/tmp/dart-scorekeeper-$releaseStamp.tgz"
$sshTarget = "$RemoteUser@$VmHost"

Push-Location $projectRoot
try {
  npm run build
  tar.exe -czf $archive dist server.mjs package.json package-lock.json deployment/yandex
  scp -i $IdentityFile -o IdentitiesOnly=yes $archive "${sshTarget}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to transfer the release archive.' }

  $remoteScript = @'
set -euo pipefail
archive="$1"
stamp="$2"
public_url="$3"
release_root=/opt/dart-scorekeeper/releases
release_dir="$release_root/$stamp"
previous_target=""
if [[ -L /opt/dart-scorekeeper/current ]]; then
  previous_target="$(readlink -f /opt/dart-scorekeeper/current 2>/dev/null || true)"
fi
sudo install -d -m 0755 "$release_root"
sudo install -d -m 0755 "$release_dir"
sudo tar -xzf "$archive" -C "$release_dir"
sudo test -f "$release_dir/server.mjs"
sudo test -f "$release_dir/dist/index.html"
sudo chown -R root:root "$release_dir"
sudo ln -sfn "$release_dir" /opt/dart-scorekeeper/current
release_ok=true
sudo systemctl restart dart-scorekeeper.service || release_ok=false
if [[ "$release_ok" == true ]]; then
  curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/healthz >/dev/null || release_ok=false
fi
if [[ "$release_ok" == true && -n "$public_url" ]]; then
  curl --fail --silent --show-error --retry 12 --retry-delay 2 "${public_url%/}/healthz" >/dev/null || release_ok=false
fi
if [[ "$release_ok" != true ]]; then
  if [[ -n "$previous_target" && -d "$previous_target" ]]; then
    sudo ln -sfn "$previous_target" /opt/dart-scorekeeper/current
    sudo systemctl restart dart-scorekeeper.service
    curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-connrefused http://127.0.0.1:3000/healthz >/dev/null
  fi
  exit 1
fi
rm -f "$archive"
'@
  $remoteScript | ssh -i $IdentityFile -o IdentitiesOnly=yes $sshTarget "bash -s -- '$remoteArchive' '$releaseStamp' '$PublicUrl'"
  if ($LASTEXITCODE -ne 0) { throw 'Remote release failed health verification and was rolled back.' }

  if ($PublicUrl) {
    Invoke-RestMethod -Uri "$($PublicUrl.TrimEnd('/'))/healthz" -Method Get | Out-Null
  }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
