# Blooket Lite

A small helper panel for [Blooket](https://www.blooket.com), pasted into the browser's DevTools console. One file, no install, nothing sent anywhere except to Blooket itself.

## Where it works

| Where | What you get |
|---|---|
| **New game server** (per-mode hosts like `cyber.blooket.com`, `gold.blooket.com`) | Auto Answer that learns each correct answer from the server's reply, Correct ESP, Answer/Continue speed, Autoplay, Player Radar, Find Set + Import Answers, Pull Answers |
| Crypto Hack (`cyber.`) | Prize ESP, Auto Chest, Auto Continue, Password ESP + Auto Guess (works out a target's password across hacks) |
| Gold Quest (`gold.`) | Chest ESP, Auto Chest, Auto Continue, Auto Target (richest player on Take/Swap) |
| **Solo** (`solo.blooket.com`) | Auto Answer / Known Only / Highlight Known, learned per question set and kept between sessions |

Blooket's old game server (`play.blooket.com` live games) isn't supported.

## How it works

On the new server and in solo, Blooket grades answers on the server and never sends the answer key to the browser ahead of time. So this script **learns**: every time you answer, the server's reply says what was right, and the script saves it (in your browser's `localStorage`). Next time that question comes up, it knows. Pull Answers and Find Set try to get a whole set's key before the game starts.

## Use

1. Open a Blooket game in Chrome.
2. Open DevTools (`Cmd+Opt+J` on Mac, `Ctrl+Shift+J` on Windows).
3. Paste the contents of [`blooket-lite.js`](blooket-lite.js) and press Enter.

Press `\` (or paste again) to show or hide the panel. ✕ (click twice) stops everything and removes it.

## Status

Experimental. Message names and screen layouts come from captured games and Blooket changes them without notice; several features are tested only against the mocks in `test/`. If something doesn't work, the **Record Messages** card captures 60 s of the game's messages that you can attach to an issue.

## Tests

```sh
npm install
npm test
```

The tests run the script against mocked Blooket pages (jsdom).

## Disclaimer

Not affiliated with or endorsed by Blooket. Using scripts like this breaks Blooket's Terms of Service and can get an account flagged. Use it at your own risk.

## License

[MIT](LICENSE)
