# 🚩 Twitter Handle Flagger

A community-driven Chrome extension that identifies and color-codes Twitter/X accounts based on their category (IT Cells, paid promoters, bots, etc.).

![Extension Preview](https://img.shields.io/badge/Platform-Chrome-green) ![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ Features

- **🎨 Color-coded tweets** - Flagged accounts get visual indicators
- **🏷️ Category badges** - See the category next to usernames
- **📊 Hover tooltips** - View details like report count and date added
- **🚩 Easy reporting** - Flag any handle with one click
- **🗳️ Democratic verification** - 5 unique reports = handle added
- **🔄 Auto-sync** - Database updates every 6 hours
- **🔒 Transparent** - All data is public and auditable

## 📦 Installation

### Option 1: Load from Source (Recommended)

1. **Clone this repository**
   ```bash
   git clone https://github.com/xxddgghh/twitter-handle-flagger.git
   ```

2. **Open Chrome Extensions**
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (top right)

3. **Load the extension**
   - Click "Load unpacked"
   - Select the cloned folder

4. **Done!** Visit Twitter/X and the extension will work automatically.

### Option 2: Download ZIP

1. [Download ZIP](https://github.com/xxddgghh/twitter-handle-flagger/archive/refs/heads/main.zip)
2. Extract the folder
3. Load in Chrome as above

## 🏷️ Categories

| Category | Color | Description |
|----------|-------|-------------|
| 🟠 **BJP IT Cell** | Saffron | Suspected BJP social media operatives |
| 🔵 **Congress IT Cell** | Light Blue | Suspected Congress social media operatives |
| 🔵 **AAP IT Cell** | Blue | Suspected AAP social media operatives |
| 🟡 **Paid Promoter** | Gold | Undisclosed paid promotion accounts |
| ⚫ **Bot/Automated** | Gray | Suspected bot accounts |
| 🔴 **Propaganda** | Red | Misinformation/propaganda accounts |

## 🚩 How to Report a Handle

### Via Extension (Easy)
1. On Twitter, find a suspicious account's tweet
2. Click the 🚩 flag icon on the tweet
3. Select a category
4. Click "Submit Report via GitHub"

### Via GitHub Issue (Manual)
Create a [new issue](https://github.com/xxddgghh/twitter-handle-flagger/issues/new) with title:
```
[REPORT] @username - category_id
```

**Category IDs:** `bjp_it_cell`, `congress_it_cell`, `aap_it_cell`, `paid_promoter`, `bot_automated`, `propaganda`

## 🔄 How Verification Works

```
User A reports @handle → 1/5 reports
User B reports @handle → 2/5 reports
User C reports @handle → 3/5 reports
User D reports @handle → 4/5 reports
User E reports @handle → 5/5 ✅ ADDED TO DATABASE
```

- **5 unique users** must report a handle
- Same user can't report twice
- GitHub Action automatically processes reports
- All reporters are credited

## ⚙️ Settings

Click the extension icon to access:

- **Toggle categories** - Show/hide specific categories
- **Show badges** - Display category label next to username
- **Show tooltips** - Hover info with details
- **Highlight style** - Border, background, or both
- **Sync database** - Manually refresh the handle list

## 🛡️ Privacy & Ethics

- ✅ Only flags **public** Twitter handles
- ✅ **Transparent** - All data is public in this repo
- ✅ **Democratic** - 5 reports required prevents abuse
- ✅ **Contestable** - Dispute flags via GitHub Issues
- ✅ **Open source** - Full code visibility

## 🤝 Contributing

1. **Report handles** - Use the extension or GitHub Issues
2. **Improve code** - Submit pull requests
3. **Suggest features** - Open an issue
4. **Spread the word** - Share with others

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

**Made with ❤️ for a more transparent Twitter**
