param(
  [Parameter(Mandatory = $true)]
  [string]$VmHost,
  [string]$RemoteUser = 'yc-user',
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\darts-yandex-v4",
  [string]$PublicUrl = '',
  [int]$KeepReleases = 5,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseStamp = Get-Date -Format 'yyyyMMddHHmmss'
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "dart-scorekeeper-$releaseStamp.tgz"
$remoteArchive = "/tmp/dart-scorekeeper-$releaseStamp.tgz"
$sshTarget = "$RemoteUser@$VmHost"
$previousBuildRevision = $env:BUILD_REVISION

# Every value handed to the remote shell is single-quoted, so a quote in it cannot end the argument.
function ConvertTo-BashArgument {
  param([string]$Value)
  return "'" + ($Value -replace "'", "'\''") + "'"
}

function Invoke-Step {
  param([string]$Description, [string]$Command, [string[]]$Arguments)
  Write-Host "==> $Description"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}

Push-Location $projectRoot
try {
  $revision = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($revision)) { throw 'Unable to read the current git revision.' }
  $env:BUILD_REVISION = $revision

  if ($SkipChecks) {
    Write-Warning 'Preflight checks skipped by request; the release is not verified.'
  } else {
    Invoke-Step 'Lint' 'npm' @('run', 'lint')
    Invoke-Step 'Typecheck' 'npm' @('run', 'typecheck')
    Invoke-Step 'Unit tests' 'npm' @('test')
    Invoke-Step 'Server tests' 'npm' @('run', 'test:server')
    Invoke-Step 'PWA tests' 'npm' @('run', 'test:pwa')
  }

  Invoke-Step 'Build' 'npm' @('run', 'build')
  tar.exe -czf $archive dist server.mjs package.json package-lock.json deployment/yandex
  if ($LASTEXITCODE -ne 0) { throw 'Failed to pack the release archive.' }
  scp -i $IdentityFile -o IdentitiesOnly=yes $archive "${sshTarget}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to transfer the release archive.' }

  $remoteScript = @'
set -euo pipefail
archive="$1"
stamp="$2"
public_url="$3"
expected_revision="$4"
keep_releases="$5"
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

health_body() {
  curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-connrefused "$1/healthz"
}
revision_of() {
  sed -n 's/.*"revision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

release_ok=true
failure=""
sudo systemctl restart dart-scorekeeper.service || { release_ok=false; failure="service restart"; }
if [[ "$release_ok" == true ]]; then
  local_health="$(health_body http://127.0.0.1:3000 || true)"
  if [[ -z "$local_health" ]]; then
    release_ok=false
    failure="local health check"
  else
    deployed_revision="$(printf '%s' "$local_health" | revision_of)"
    if [[ "$deployed_revision" != "$expected_revision" ]]; then
      release_ok=false
      failure="revision mismatch: deployed '$deployed_revision', expected '$expected_revision'"
    fi
  fi
fi
if [[ "$release_ok" == true && -n "$public_url" ]]; then
  public_health="$(curl --fail --silent --show-error --retry 12 --retry-delay 2 "${public_url%/}/healthz" || true)"
  if [[ -z "$public_health" ]]; then
    release_ok=false
    failure="public health check"
  elif [[ "$(printf '%s' "$public_health" | revision_of)" != "$expected_revision" ]]; then
    release_ok=false
    failure="public revision mismatch"
  fi
fi
if [[ "$release_ok" != true ]]; then
  echo "release rejected: $failure" >&2
  if [[ -n "$previous_target" && -d "$previous_target" ]]; then
    sudo ln -sfn "$previous_target" /opt/dart-scorekeeper/current
    sudo systemctl restart dart-scorekeeper.service
    health_body http://127.0.0.1:3000 >/dev/null
  fi
  exit 1
fi

# Keep only the newest releases; the live one and its predecessor are never removed.
current_target="$(readlink -f /opt/dart-scorekeeper/current)"
mapfile -t releases < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
index=0
for name in "${releases[@]}"; do
  index=$((index + 1))
  (( index > keep_releases )) || continue
  candidate="$release_root/$name"
  [[ "$candidate" != "$current_target" ]] || continue
  [[ "$candidate" != "$previous_target" ]] || continue
  sudo rm -rf -- "$candidate"
done

rm -f "$archive"
'@

  $remoteArguments = @($remoteArchive, $releaseStamp, $PublicUrl, $revision, [string]$KeepReleases) |
    ForEach-Object { ConvertTo-BashArgument $_ }
  $remoteScript | ssh -i $IdentityFile -o IdentitiesOnly=yes $sshTarget "bash -s -- $($remoteArguments -join ' ')"
  if ($LASTEXITCODE -ne 0) { throw 'Remote release failed verification and was rolled back.' }

  if ($PublicUrl) {
    $health = Invoke-RestMethod -Uri "$($PublicUrl.TrimEnd('/'))/healthz" -Method Get
    if ($health.revision -ne $revision) {
      throw "Public endpoint reports revision '$($health.revision)' instead of '$revision'."
    }
  }
  Write-Host "Released $revision as $releaseStamp."
} finally {
  if ($null -eq $previousBuildRevision) { Remove-Item Env:BUILD_REVISION -ErrorAction SilentlyContinue } else { $env:BUILD_REVISION = $previousBuildRevision }
  Pop-Location
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
