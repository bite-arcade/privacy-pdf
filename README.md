# PrivacyPDF

### *Free, private, and secure PDF compression — 100% in your browser. No uploads. No storage. No tracking.*

[![GitHub stars](https://img.shields.io/github/stars/bite-arcade/privacy-pdf?style=flat-square)](https://github.com/bite-arcade/privacy-pdf/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/bite-arcade/privacy-pdf?style=flat-square)](https://github.com/bite-arcade/privacy-pdf/network)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

🌐 **Live demo:** https://privacypdf.org

![PrivacyPDF homepage](https://privacypdf.org/assets/privacy-pdf-banner.webp)

PrivacyPDF is a PDF compression tool that runs **entirely on the client side**.
Your files are processed in the browser and **never leave your device** — no
uploads to any server, no storage, no tracking.

## ✨ Features

- **100% local processing** — all compression happens in your browser.
- **Batch compression** — drop multiple PDFs and compress them together.
- **Adjustable quality** — Light / Balanced / Extreme compression levels.
- **ZIP export** — download all results as a single ZIP.
- **Privacy by design** — no server ever sees your documents.
- **Open source** — the full frontend codebase is on GitHub.

## 🔒 Why open source?

PDF tools usually require uploading sensitive files to a third-party server.
PrivacyPDF takes the opposite approach: because the code is open, anyone can
verify that files are processed locally and never transmitted. That is the
strongest possible privacy guarantee.

## 🚀 How to Use

Use it online at **https://privacypdf.org**, or self-host it:

```bash
# 1. Clone the repository
git clone https://github.com/bite-arcade/privacy-pdf.git
# 2. Enter the directory
cd privacy-pdf
# 3. Serve the static files (any static server works)
python3 -m http.server 8080
# Then open http://localhost:8080
```

> ⚠️ **FOR LOCAL TESTING ONLY, DO NOT EXPOSE TO PUBLIC INTERNET.** This is a
> static site; a local server is enough to preview it on your machine.

## 🤝 Contributing

Found a bug or want to improve compression? Open a GitHub Issue or Pull Request.
Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. For security issues, do
**not** open a public issue — contact the maintainer privately.

## 📚 Related Projects

- [Tiny Arcade](https://github.com/bite-arcade/tiny-arcade) — 250+ retro arcade games
- [Bite Arcade](https://github.com/bite-arcade/bite-arcade) — 500+ free online games

## 📄 License

Released under the [MIT License](LICENSE).
