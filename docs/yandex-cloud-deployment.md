# Dart Scorekeeper в Yandex Cloud

## Production endpoint

- Application: `https://d5dea34ovm6biisul5p6.y0g3kng5.apigw.yandexcloud.net`
- Health: `https://d5dea34ovm6biisul5p6.y0g3kng5.apigw.yandexcloud.net/healthz`
- Folder: `b1g23gu6drnipiu9iajr`
- Zone: `ru-central1-a`

## Architecture

```text
Internet / HTTPS
        |
        v
darts-gateway (request logging disabled)
        |
        | private HTTP through darts-net
        v
10.77.0.10:3000 — darts-vm — Node.js 24 LTS / systemd
        |
        v
darts-data — ext4 — /var/lib/dart-scorekeeper
```

The VM public IPv4 is dynamic and exists only for key-based administration. Users always open the stable API Gateway domain. Port 3000 is allowed only from the API Gateway service network (`198.19.0.0/16`) and the project subnet; it is not open to the internet.

## Resources

| Resource | Name | ID / value |
| --- | --- | --- |
| Network | `darts-net` | `enpkmg4e9kknic65opb1` |
| Subnet | `darts-subnet` | `e9btaujpdupqfkqohf2o`, `10.77.0.0/24` |
| Security group | `darts-sg` | `enpgduhipvqqtt1kee4e` |
| VM | `darts-vm` | `fhmsa6ctmrsr66481j0b`, private IP `10.77.0.10` |
| Boot disk | `darts-boot` | `fhmpegu1b4rb2lsccd4v`, 10 GB `network-hdd`, auto-delete enabled |
| Data disk | `darts-data` | `fhm6tvolb6sscftsogp6`, 4 GB `network-hdd`, auto-delete disabled |
| API Gateway | `darts-gateway` | `d5dea34ovm6biisul5p6` |
| Initial snapshot | `darts-data-initial-20260911` | `fd89jkqoqd2jplnjkkco` |
| Budget | `darts-monthly-3000` | `dn2drnrmvo94d4tek7t4` |

The VM uses `standard-v2`, 2 vCPU at 5% baseline and 1 GB RAM. This is the cheapest tested non-preemptible configuration that preserves automatic recovery. The boot disk is the Ubuntu 24.04 LTS minimum; the separate 4 GB disk is ample for the current JSON and bounded backups.

## Cost estimate

The estimate uses current RUB SKU rates returned by the Yandex Billing API on 2026-09-11:

| Item | Rate | Estimated hourly cost |
| --- | ---: | ---: |
| 2 × Intel Cascade Lake 5% vCPU | 0.1897 ₽ / core-hour | 0.3794 ₽ |
| 1 GB RAM | 0.3676 ₽ / GB-hour | 0.3676 ₽ |
| 14 GB network HDD | 0.0048 ₽ / GB-hour | 0.0672 ₽ |
| Active dynamic public IP | 0.26352 ₽ / hour | 0.26352 ₽ |
| Initial snapshot (about 56 MiB stored) | 0.0051 ₽ / GB-hour | about 0.00029 ₽ |
| API Gateway | first 100,000 requests/month free; then 142.3 ₽ / million | 0 ₽ at test load |

Expected total at low traffic: about `1.078 ₽/hour`, `25.87 ₽/day`, `776.16 ₽/30 days`, or `1,552.33 ₽/60 days`, excluding unusual outbound traffic or traffic above free allowances. This is within the approximately 4,000 ₽ grant. The active monthly expense budget sends notifications at 1,000 ₽, 2,000 ₽, and the 3,000 ₽ limit. A budget warns but does not stop resources.

## Runtime and data

- Service: `dart-scorekeeper.service`, user/group `darts`.
- Release symlink: `/opt/dart-scorekeeper/current`.
- Immutable releases: `/opt/dart-scorekeeper/releases/<timestamp>`.
- Production JSON: `/var/lib/dart-scorekeeper/dart-scorekeeper.json`.
- Backups: `/var/lib/dart-scorekeeper/backups/`.
- Timer: `dart-scorekeeper-backup.timer`, every six hours, retaining 24 newest, 14 daily, and 6 monthly copies.

## Audit hardening notes

- Requests are logged as structured JSON. Group tokens and secret URL segments are never logged; only a short non-reversible token hash may be used for correlation.
- The generated API Gateway template is an operator artefact and must be regenerated from the deployment inputs; do not commit live tokens or credentials.
- Company updates use `If-Match`; a stale writer receives a conflict and must reload before retrying.
- Every local backup is validated before retention and accompanied by a SHA-256 checksum.
- Off-disk disaster recovery requires an owner-approved Object Storage bucket or snapshot service, a write-only service account, credential rotation, object lock, and lifecycle policy. This repository deliberately does not create external cloud resources because the required account and credentials are environment-owned.
- Mount: ext4 by UUID in `/etc/fstab` at `/var/lib/dart-scorekeeper`.

The data directory is outside every release. Deployment never copies an empty JSON over production data.

## Status and logs

First obtain the current dynamic administrative IP:

```powershell
yc compute instance get darts-vm
```

Then use the dedicated SSH key and current IP:

```powershell
ssh -i "$env:USERPROFILE\.ssh\darts-yandex-v4" yc-user@<PUBLIC_IP> "sudo systemctl status dart-scorekeeper.service"
ssh -i "$env:USERPROFILE\.ssh\darts-yandex-v4" yc-user@<PUBLIC_IP> "sudo journalctl -u dart-scorekeeper.service -n 100 --no-pager"
ssh -i "$env:USERPROFILE\.ssh\darts-yandex-v4" yc-user@<PUBLIC_IP> "curl --fail http://127.0.0.1:3000/healthz"
```

Gateway request logging is deliberately disabled because the company connection token is part of the URL path. Application logs contain process lifecycle messages, not request paths or tokens.

## Deploy a new accepted version

From a clean, tested `master` checkout:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-yandex.ps1 `
  -VmHost <CURRENT_PUBLIC_IP> `
  -PublicUrl "https://d5dea34ovm6biisul5p6.y0g3kng5.apigw.yandexcloud.net"
```

The helper builds locally, transfers a temporary archive, creates a timestamped release, atomically switches the `current` symlink, restarts systemd, and checks local and public health. If health fails, it restores the previous valid release. It never writes to `/var/lib/dart-scorekeeper`.

If the deployment computer's public IP changes, update only the SSH `/32` rule in `darts-sg` before connecting. Do not broaden it permanently to `0.0.0.0/0`.

## Restart, stop, and start

Restart only the process:

```powershell
ssh -i "$env:USERPROFILE\.ssh\darts-yandex-v4" yc-user@<PUBLIC_IP> "sudo systemctl restart dart-scorekeeper.service"
```

Stop and start the VM:

```powershell
yc compute instance stop darts-vm
yc compute instance start darts-vm
```

The public administrative IP may change after start. The Gateway URL and VM private IP remain unchanged.

While the VM is running, compute, RAM, disks, and the active public IP are billed. While it is stopped, compute/RAM and its released dynamic IP are not billed, but both disks and the snapshot remain billable. API Gateway is request-based and costs nothing while idle within its free allowance.

## Backups and recovery

Run a backup immediately:

```powershell
ssh -i "$env:USERPROFILE\.ssh\darts-yandex-v4" yc-user@<PUBLIC_IP> "sudo systemctl start dart-scorekeeper-backup.service"
```

Create another recovery snapshot only when needed:

```powershell
yc compute snapshot create --name darts-data-manual-YYYYMMDD --disk-name darts-data --labels project=dart-scorekeeper
```

Backups on the same disk protect against a bad write but not disk deletion. The initial Yandex snapshot is a separate recovery point.

## Stop all spending without accidental data loss

Do not automate teardown. First stop the VM, download and validate a backup outside Yandex Cloud, and record its checksum. Only after that independent copy is confirmed may the data disk and snapshot be deleted.

A safe partial shutdown that retains cloud recovery data is:

1. `yc compute instance stop darts-vm`.
2. Keep `darts-data` and `darts-data-initial-20260911`; they continue to incur only storage charges.
3. Optionally delete `darts-gateway` if the stable URL is no longer needed.

For zero ongoing cloud charges after an external backup is verified: delete the Gateway, VM, data disk, snapshot, security group, subnet, and network in that order. Deleting the VM alone does not delete `darts-data`, because its auto-delete flag is disabled. Never delete `darts-data` or the snapshot before verifying the external backup.
