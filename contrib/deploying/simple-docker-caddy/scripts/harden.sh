#!/usr/bin/env bash
# Baseline VPS hardening for a single-node Carbon Swarm host (Ubuntu/Debian).
#
# Idempotent. Run once as root on a fresh droplet BEFORE deploying:
#   sudo ./scripts/harden.sh
#
# Does: firewall (allow SSH/HTTP/HTTPS only), fail2ban, a swapfile if none, and
# unattended security upgrades. Mirrors the hardening in DigitalOcean's
# supabase-on-do reference. Review each step for your environment.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo $0)"; exit 1; }

SWAP_SIZE="${SWAP_SIZE:-2G}"
SSH_PORT="${SSH_PORT:-22}"

log() { printf '\033[0;36m[harden]\033[0m %s\n' "$*"; }

# ── Firewall: default-deny inbound, allow SSH + the two Caddy ports only ──────
log "Configuring UFW firewall"
export DEBIAN_FRONTEND=noninteractive
apt-get -y update
apt-get -y install ufw fail2ban unattended-upgrades

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp" comment 'SSH'
ufw allow 80/tcp  comment 'HTTP (ACME + redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3'
ufw --force enable
log "UFW enabled. Docker publishes via the host firewall; only 80/443 are public."

# ── fail2ban: protect SSH from brute force ───────────────────────────────────
log "Enabling fail2ban (sshd jail)"
cat >/etc/fail2ban/jail.d/carbon.conf <<-EOF
	[sshd]
	enabled = true
	port    = ${SSH_PORT}
	maxretry = 5
	bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ── Swap: give a small VPS headroom (app builds + Postgres) ───────────────────
if ! swapon --show | grep -q .; then
	log "Creating ${SWAP_SIZE} swapfile"
	fallocate -l "$SWAP_SIZE" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	sysctl -w vm.swappiness=10
	grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >>/etc/sysctl.conf
else
	log "Swap already present — skipping"
fi

# ── Automatic security updates ───────────────────────────────────────────────
log "Enabling unattended-upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Done. Reminder: SSH key-only auth + a non-root sudo user are recommended."
