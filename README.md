# SFMC Preview Bookmarker

A Chrome extension that bookmarks and auto-navigates Data Extension paths in the Salesforce Marketing Cloud (SFMC) "Preview and Test" panel.

## Features

- **Bookmark DE paths** — Save folder paths + target Data Extensions for one-click navigation
- **Record from page** — Click folders and DEs on the SFMC tree to capture paths automatically
- **Run bookmarks** — Auto-expands folders, clicks "Load More" as needed, and selects the DE

## Installation

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select this folder

## Usage

1. Open an email in SFMC Content Builder and go to **Preview and Test**
2. Click the extension icon → **+ New Bookmark**
3. Use **⏺ Record from Page** to click through folders and a DE on the tree, then re-open the popup and hit **⏹ Stop**
4. Give it a name and **Save**
5. Next time, just hit **▶ Run** to auto-navigate to that DE

## Permissions

- `activeTab` — interact with the current SFMC tab
- `storage` — persist bookmarks locally
