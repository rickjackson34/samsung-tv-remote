# TV Remote for Samsung Smart TVs

Control a Samsung Smart TV (Tizen, 2016 and newer) from your phone: power, D-pad, a swipe touchpad, volume, channels, number pad, playback, typing into TV search boxes, and one-tap app launch (Netflix, YouTube, Prime Video, Disney+, Max, Hulu, Apple TV, Spotify, Plex).

## How it works

Samsung TVs only accept remote commands from your home network, over a connection that phone browsers block. So the remote has two parts:

- **A small bridge server** (`server.js`) that runs on any always-on computer on your Wi-Fi (a PC, Mac, Raspberry Pi, or NAS). It talks to the TV.
- **The remote itself**, a web app the bridge serves to your phone. Add it to your home screen and it opens full-screen like a regular app.

```
phone ──Wi-Fi──▶ bridge server (:8080) ──▶ Samsung TV (:8001 / :8002)
```

## Setup

You need Node.js 20 or newer on the computer that runs the bridge.

```bash
cd samsung-tv-remote
npm install
npm start
```

It prints an address such as `http://192.168.1.23:8080`. Then:

1. Turn the TV on. The TV, the computer, and your phone must all be on the same Wi-Fi.
2. On your phone, open that address.
3. Tap **Find my TV** (or type the TV's IP address from *Settings › General › Network › Network Status › IP Settings*), then **Connect**.
4. Choose **Allow** on the TV when it asks. The remote remembers the TV after this.
5. Add it to your home screen:
   - **iPhone (Safari):** Share button › *Add to Home Screen*.
   - **Android (Chrome):** ⋮ menu › *Add to Home screen* / *Install app*.

### Turning the TV on from the remote

When the TV is off, the power button sends a Wake-on-LAN packet. Enable it on the TV under *Settings › General › Network › Expert Settings › Power On with Mobile*, and connect the TV once while it's on so the remote learns its network address (MAC). TVs on a wired Ethernet connection wake most reliably.

### Keeping it running

To start the bridge automatically, run it with a process manager such as `pm2`:

```bash
npx pm2 start server.js --name tv-remote && npx pm2 save
```

Options (environment variables): `PORT` (default `8080`), `HOST` (default `0.0.0.0`), `REMOTE_CONFIG` (where the TV's IP and pairing token are saved; default `config.json` in this folder).

## Troubleshooting

- **"The TV denied access"** — you tapped Deny, or the TV blocks new devices. Go to *Settings › General › External Device Manager › Device Connection Manager*, set *Access Notification* to *First Time Only*, and remove *Phone Remote* from the device list if it's marked as denied. Then connect again.
- **"No Samsung TV answered"** — the TV is off, or on a different network (for example a guest Wi-Fi). Some routers isolate devices; turn off *AP/client isolation*.
- **Find my TV finds nothing** — some routers block discovery. Type the IP address instead. Giving the TV a fixed IP address in your router settings stops it from changing.
- **Buttons do nothing** — check the dot next to the TV name: green means on, amber means standby, grey means unreachable.

## Security

Anyone on your Wi-Fi who opens the bridge address can control the TV, just as with Samsung's own SmartThings app. The bridge only sends the remote keys and apps listed in `lib/protocol.js`, and only to private (home network) IP addresses. Don't expose port 8080 to the internet.

## Development

```bash
npm test
```

Tests cover the TV message formats and run the TV client against a fake TV.
