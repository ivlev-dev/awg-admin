# Umbra VPN

Umbra VPN is an Android VPN client built on WireGuard and AmneziaWG. It focuses on
simple, reliable tunnel management with optional automation.

## Features

- WireGuard and AmneziaWG tunnels (AmneziaWG 2.0 through 3.1 obfuscation options)
- Auto-tunneling based on the active network (Wi-Fi, mobile data, ethernet)
- Split tunneling per app, per tunnel or globally
- Split and encrypted DNS (plain DNS, DoT, DoH)
- Local SOCKS5 / HTTP proxy mode
- Lockdown mode, native kill switch and LAN bypass
- Quick Settings tile, home screen shortcuts and remote control intents
- Dynamic DNS endpoint updates, IPv6 endpoints, tunnel recovery
- Android TV support

## Build

Requirements: JDK 21 and the Android SDK.

```bash
./gradlew :app:assembleFdroidDebug
```

The APK is written to `app/build/outputs/apk/fdroid/debug/`.

## Project layout

- `app` — Android application module
- `logcatter`, `networkmonitor`, `pinger` — small supporting Android libraries

## License

Distributed under the MIT License. See [LICENSE](LICENSE).

This project is a rebranded fork of the open source
[wgtunnel/android](https://github.com/wgtunnel/android) project and includes
components derived from WireGuard and AmneziaWG. See [NOTICE](NOTICE) for the
full attribution.
