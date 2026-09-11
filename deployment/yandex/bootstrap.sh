#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-.}"
data_device=/dev/disk/by-id/virtio-darts-data
data_dir=/var/lib/dart-scorekeeper

test -b "$data_device"

if ! id darts >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin darts
fi

if ! blkid -s TYPE -o value "$data_device" | grep -q .; then
  mkfs.ext4 -L darts-data "$data_device"
fi

data_uuid="$(blkid -s UUID -o value "$data_device")"
install -d -m 0750 -o darts -g darts "$data_dir"
if ! grep -q "UUID=$data_uuid" /etc/fstab; then
  printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$data_uuid" "$data_dir" >>/etc/fstab
fi
mount "$data_dir" 2>/dev/null || mount -a
chown darts:darts "$data_dir"
chmod 0750 "$data_dir"
install -d -m 0750 -o darts -g darts "$data_dir/backups"
install -d -m 0755 /opt/dart-scorekeeper/releases

install -o root -g root -m 0644 "$artifact_dir/dart-scorekeeper.service" /etc/systemd/system/dart-scorekeeper.service
install -o root -g root -m 0755 "$artifact_dir/dart-scorekeeper-backup" /usr/local/sbin/dart-scorekeeper-backup
install -d -m 0755 /usr/local/lib/dart-scorekeeper
install -o root -g root -m 0644 "$artifact_dir/validate-storage.mjs" /usr/local/lib/dart-scorekeeper/validate-storage.mjs
install -o root -g root -m 0644 "$artifact_dir/dart-scorekeeper-backup.service" /etc/systemd/system/dart-scorekeeper-backup.service
install -o root -g root -m 0644 "$artifact_dir/dart-scorekeeper-backup.timer" /etc/systemd/system/dart-scorekeeper-backup.timer
install -o root -g root -m 0644 "$artifact_dir/99-darts-security.conf" /etc/ssh/sshd_config.d/99-darts-security.conf
sshd -t
systemctl reload ssh.service
systemctl daemon-reload
systemctl enable dart-scorekeeper.service
systemctl enable --now dart-scorekeeper-backup.timer
