<div align="center">

<img src="file-sharing/public/sharing_no_background.png" alt="Quick File Logo" width="120" />

# Quick File

**Real-time P2P File Sharing — No Server, No Account, No Limits**

Transfer files directly between devices using WebRTC. Works on PC, Laptop, Tablet, and Mobile.

![Version](https://img.shields.io/badge/version-1.5.1-blue)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite)
![Capacitor](https://img.shields.io/badge/Capacitor-8-119eff?logo=capacitor)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## What is Quick File?

Quick File is a browser-based, serverless P2P file transfer app. It uses **WebRTC** (via PeerJS) to create a direct connection between two devices — your files never touch a third-party server.

Pair two devices with a **QR code** or a **4-character code**, then send files of any size with real-time progress tracking.

---

## Features

- **Zero server transfer** — Files flow directly device-to-device via WebRTC
- **QR Code pairing** — Scan to connect instantly
- **4-char short ID** — Type it manually when QR scanning is unavailable
- **Auto-connect via URL** — Share a link like `?remoteId=XXXX` to connect automatically
- **Two transfer modes**
  - Turtle (TCP-like): Reliable, buffer-managed — best for large files
  - Lightning (UDP): Maximum speed — best for small files on stable networks
- **Cancellable transfers** — Cancel mid-transfer on both sender and receiver
- **Progress bar** — Real-time percentage display
- **File preview** — Inline image thumbnails for received files
- **Drag & drop** — Drop a file anywhere on the screen to send
- **Dark / Light theme** — Persisted via cookie
- **Multilingual** — English and Thai (auto-detected from browser)
- **Mobile app** — Build to Android / iOS via Capacitor

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 |
| P2P Transport | PeerJS (WebRTC) |
| UI Library | Ant Design 6 |
| Mobile | Capacitor 8 (Android & iOS) |
| i18n | i18next + browser language detector |
| QR Code | react-qr-code, @yudiel/react-qr-scanner |

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm 9 or later

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/NobpasinTumdee/Real-time-P2P-File-Sharing.git

# 2. Enter the project folder
cd Real-time-P2P-File-Sharing/file-sharing

# 3. Install dependencies
npm install
```

### Run in Development Mode

```bash
npm run dev
```

The app will start with `--host` flag, so it is accessible from other devices on the same network.
Open the printed local URL on two devices to test P2P transfer.

### Build for Production

```bash
npm run build
```

Output goes to `file-sharing/dist/`.

### Preview Production Build

```bash
npm run preview
```

---

## How to Use

### Step 1 — Open on 2 Devices

Open the app on both the **sender** and **receiver** device. Works on any device with a modern browser.

### Step 2 — Connect / Pair

Choose one of these methods:

| Method | How |
|---|---|
| QR Code | Click **"Scan QR Code"** on one device, then point the camera at the QR displayed on the other device |
| Manual ID | Type the **4-character code** shown on the other device's screen |
| Share Link | Click the link icon to copy a URL — opening that URL on another device auto-connects |

### Step 3 — Send a File

Once connected, two upload buttons appear:

| Mode | Icon | Best For |
|---|---|---|
| Reliable (TCP-like) | Turtle | Videos, Images, ZIPs — guarantees 100% data integrity |
| Fast (UDP) | Lightning | Small files on stable networks — maximum speed |

You can also **drag and drop** any file anywhere on the screen.

### Step 4 — Download

Received files appear in a list below the transfer area. Click the download icon to save. On mobile, the file is saved to the **Documents** folder.

---

## Project Structure

```
Real-time-P2P-File-Sharing/
└── file-sharing/               # Main app (Vite + React)
    ├── public/
    │   ├── locales/            # i18n translation files
    │   │   ├── en/translation.json
    │   │   └── th/translation.json
    │   ├── flag/               # Language flag icons
    │   └── *.mp3               # Sound effects (connect, file received)
    ├── src/
    │   ├── App.tsx             # Main component — all P2P logic lives here
    │   ├── App.css             # Styles (dark/light theme variables)
    │   ├── i18n.ts             # i18next configuration
    │   └── main.tsx            # React entry point
    ├── capacitor.config.ts     # Capacitor mobile config
    ├── vite.config.ts
    └── package.json
```

---

## Adding a New Language

1. Create `file-sharing/public/locales/<lang>/translation.json`
2. Copy keys from `en/translation.json` and translate the values
3. Add a flag image to `public/flag/<lang>.png`
4. Update the language toggle button in `App.tsx`

---

## How to Build for Mobile

Capacitor wraps the Vite build into a native Android/iOS project.

### 1. Install Capacitor (already in package.json, just run install)

```bash
npm install
```

### 2. Build the web app

```bash
npm run build
```

### 3. Add Android / iOS platform (first time only)

```bash
npm install @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
```

### 4. Sync web build into native project

```bash
npx cap sync
```

### 5. Open in Android Studio

```bash
npx cap open android
```

> If the command fails, open Android Studio manually and open the `file-sharing/android/` folder as a project.

### 6. Build the APK

In Android Studio: **Build > Build Bundle(s) / APK(s) > Build APK(s)**

The debug APK is located at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

### After Code Changes — Rebuild & Sync

```bash
npm run build
npx cap sync
npx cap open android
```

---

## Environment Notes

- The app uses `PeerJS` default public signaling server for WebRTC handshake. File data itself is transferred P2P.
- `vite --host` is required for LAN access during development (already set in the `dev` script).
- Transfer cancellation works on both sender and receiver sides — a `CANCEL` packet is sent over the data channel.
- Dynamic chunk sizing: `64 KB` default, `128 KB` for files > 10 MB, `256 KB` for files > 100 MB.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

---

## Support

If this project helped you, consider supporting via the donate button in the app header.

