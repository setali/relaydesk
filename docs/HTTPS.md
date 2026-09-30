# HTTPS and the management menu

After a one-command installation, run `sudo relaydesk` for the menu, or use `sudo bash /opt/relaydesk/install.sh menu`. The launcher is added only if `/usr/local/bin/relaydesk` is free. A source checkout can use `bash install.sh menu` directly.

## Automatic certificates

During installation, enter your intended public HTTPS origin (for example `https://relay.example.com`). After the application starts, the wizard offers managed HTTPS. You can enable it later:

```sh
sudo relaydesk https enable
sudo relaydesk https status
sudo relaydesk https logs
```

The Linux-only managed gateway uses a separate, pinned Caddy container and Compose project `relaydesk-https`. It serves only the hostname or public IPv4 from the application's saved origin. No second hostname or origin rewrite is performed. A public DNS name or public IPv4 on standard port 443 is required. Public IPv4 uses Caddy 2.11.4 with an explicit Let’s Encrypt shortlived issuer, not a self-signed certificate. IP certificates expire after about six days; keep renewal running. IPv6-only managed issuance, wildcard names and DNS-provider integrations are not implemented. Private/reserved IPv4 ranges are rejected.

Before enabling:

1. For a hostname, point every A/AAAA record to this server. For IP mode, enter this server’s public IPv4; no DNS record is needed. Remove stale IPv6 records if the server has no working IPv6.
2. Ensure inbound TCP 80 and 443 reach this server. Adjust your firewall yourself if needed.
3. Confirm those ports are free. The installer checks host listeners and Docker published ports and refuses existing gateway projects/data rather than taking them over.
4. Review the explicit public-exposure confirmation. DNS resolution is checked, but it cannot prove external routing or firewall reachability.

Caddy obtains publicly trusted certificates and renews them automatically while running. Its certificate storage is persistent. The service's start message does **not** mean a certificate was issued. Run `https status` to check TLS trust/expiry, check `https logs` for issuance errors, then visit the panel from a separate network. DNS, CAA policy, NAT and ACME rate limits can prevent issuance. Never delete certificate volumes to force renewal.

The status check uses the configured public hostname from the application container, not the browser. Settings shows the same read-only certificate status and expiry, cached for one minute. With a CDN this may be the CDN's certificate, not the local gateway certificate; a valid certificate alone does not prove the correct app is being served. The web app never receives Docker control or certificate private keys.

## Existing proxy or occupied ports

The installer will not stop, edit or replace another web server, panel or VPN listener. If ports 80/443 are already in use, leave the managed gateway disabled and add a route to your existing proxy. Example for an existing host Caddy service:

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:3210
}
```

Use the actual configured hostname and local port. Review/reload your proxy through its normal management procedure. For a containerized existing proxy, host loopback is not its own loopback; configure its networking appropriately without publicly exposing Relaydesk's HTTP port. Existing proxies manage their own certificate renewal.

## Lifecycle and recovery

```sh
sudo relaydesk start          # starts the app and a previously configured gateway
sudo relaydesk https disable # asks before stopping the gateway; keeps certificates
sudo relaydesk https start   # resumes the configured gateway
sudo relaydesk stop          # stops only the app; gateway stays up and keeps renewing
```

There is no force-renew button: Caddy schedules renewal itself. If renewal fails, fix connectivity/DNS/CAA issues and inspect logs. Repeated forced issuance risks CA rate limits.

`.https.env` contains the public hostname/IP and selected gateway configuration and is created with mode 0600. `.install.env` supplies the local upstream port. Preserve both when upgrading. Never change the hostname without coordinating the application's stored origin; domain-change automation is not part of this release.

The dedicated volumes `relaydesk-https_certificates` and `relaydesk-https_gateway-config` hold gateway state. Back them up privately with your normal volume-backup procedure. They are separate from the application database/key volume. No stop command removes volumes or certificates. If setup fails after creating `.https.env`, keep it and use `https start` after resolving the error. If gateway storage exists but that file is missing, restore the file from backup instead of rerunning enable.

Implementation reference: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https). Public certificate issuance still needs a reachable public domain or IPv4 and must be verified on the destination host before production use.
