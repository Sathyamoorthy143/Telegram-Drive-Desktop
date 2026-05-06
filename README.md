# Telegram Drive Desktop (Enhanced)

**Telegram Drive Desktop** is an open-source, cross-platform desktop application that turns your Telegram account into an unlimited, secure cloud storage drive. This version features several enhancements, including **Real-time Upload Stats (Speed/ETA)**, **Recursive Folder Upload**, and **User Profile Management**.

Built with **Tauri**, **Rust**, and **React**.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20MacOS%20%7C%20Linux-blue)

---

## 🚀 Key Enhancements in this Version

*   **User Profile Card**: View your Telegram account details (name, username) directly in the sidebar.
*   **Live Upload Stats**: Monitor real-time **Network Speed (MB/s)** and **Estimated Time of Arrival (ETA)** for every file.
*   **Recursive Folder Upload**: Select an entire folder to upload; the app will walk the directory and queue all files for you.
*   **Stability Fixes**: Improved handling of large file transfers and network reconnects.

---

## 💡 Important Tips

> [!TIP]
> **Fast Login Tip:** For faster access during initial setup and testing, you may want to temporarily disable **Two-Step Verification (Cloud Password)**. You can re-enable it once you are logged in.

> [!NOTE]
> **Open Source & Contributions:** This project is fully open source. You are encouraged to fork it, add new features, and contribute back! Whether it's adding dark mode tweaks or implementing new MTProto features, all contributions are welcome.

---

## 🛠️ Getting Started

### Prerequisites
*   **Node.js (v18+)**
*   **Rust (latest stable)**
*   **OS-Specific Build Tools** (See [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/))

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/Sathyamoorthy143/Telegram-Drive-Desktop.git
    cd Telegram-Drive-Desktop
    ```

2.  **Install Dependencies**
    ```bash
    cd app
    npm install
    ```

3.  **Run in Development Mode**
    ```bash
    npm run tauri dev
    ```

---

## Credits
This project is based on the original work by [caamer20](https://github.com/caamer20/Telegram-Drive). We thank the community for the inspiration and the core framework.

## License
Licensed under the **MIT License**.

