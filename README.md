# PrivacyPDF — 100% Local PDF Compression

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/privacypdf-local-pdf-comp/oopdaijnpdggadnchldhffnepeijidil)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live Site](https://img.shields.io/badge/website-privacypdf.org-green)](https://privacypdf.org)

A free, privacy-first PDF compressor that runs **100% in your browser**. No uploads, no servers, no tracking. Your files never leave your device.

## ✨ Features

- **Three compression modes** — Light (best quality), Balanced (recommended), Extreme (smallest size)
- **Batch processing** — compress multiple PDFs at once
- **ZIP export** — download all compressed files as a single archive
- **Zero data upload** — all processing happens locally using pdf-lib, pdf.js, and JSZip
- **No account required** — no sign-up, no email, no subscription
- **Chrome extension available** — compress PDFs right from your browser toolbar

## 🚀 Quick Start

### Use Online

Visit [privacypdf.org](https://privacypdf.org) — no installation needed.

### Install Chrome Extension

Add the [PrivacyPDF Chrome Extension](https://chromewebstore.google.com/detail/privacypdf-local-pdf-comp/oopdaijnpdggadnchldhffnepeijidil) for one-click access.

### Run Locally

```bash
# Clone the repository
git clone https://github.com/bite-arcade/privacy-pdf.git

# Enter the directory
cd privacy-pdf

# Serve the static files (any static server works)
python3 -m http.server 8080

# Then open http://localhost:8080
```

> ⚠️ **FOR LOCAL TESTING ONLY.** Do not expose to public internet. This is a static site; a local server is enough to preview it on your machine.

## 🔒 Why Local Processing Matters

Most online PDF compressors work by uploading your file to a remote server, processing it, and sending back the result. This means your documents — contracts, financial records, medical information, personal data — are transmitted across the internet and stored on third-party servers, even if only temporarily.

PrivacyPDF takes a different approach. All compression happens directly in your browser using JavaScript libraries. Your PDF never leaves your device. There is no server to hack, no database to breach, no log file to subpoena. When you close the tab, the file is gone from memory.

## 🛠️ Tech Stack

- **pdf-lib** — PDF creation and modification
- **pdf.js** — PDF rendering and analysis
- **JSZip** — ZIP archive generation for batch downloads
- **Pure frontend** — no frameworks, no backend, no build step

## 📚 Related Projects

- [Tiny Arcade](https://github.com/bite-arcade/tiny-arcade) — 250+ retro arcade games
- [Bite Arcade](https://github.com/bite-arcade/bite-arcade) — 500+ free browser games

## 🏛️ About the Publisher — Hearth Veil Press

Every great story begins with a choice: to face the world as it is, or to imagine it as it could be. At Hearth Veil Press, we believe you don't have to choose.

**Hearth** is for the world you live in — the real one, with its bills, its decisions, its quiet struggles, and its small victories. It's the knowledge that helps you build a stable foundation: clear financial frameworks, practical AI strategies, and evidence-based guidance.

**Veil** is for the worlds you dream of — where magic has rules, power has a price, and love and fate collide across shifting battlefields.

Together, they form a single publishing philosophy: **Where Practical Truths Meet Fictional Veils.**

### Free Tools & Resources

Beyond publishing, we build free, privacy-first digital tools and entertainment platforms:

- [hearthveilpress.com](https://hearthveilpress.com) — Official publisher site
- [PrivacyPDF.org](https://privacypdf.org) — Free, privacy-first online PDF toolkit
- [Bite Arcade](https://bite-arcade.com) — 500+ free browser games
- [Tiny Arcade](https://tiny-arcade.com) — 257+ retro arcade games

## 🤝 Contributing

Report bugs via GitHub Issues, suggest new features, or open a Pull Request.

## 📄 License

Released under the [MIT License](LICENSE).
