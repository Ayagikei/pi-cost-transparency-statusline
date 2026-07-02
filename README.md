# @nilskluewer/pi-statusline

A rich terminal status line for the [Pi coding agent](https://pi.dev/).

It replaces Pi's footer with a compact multi-line view showing:

- current working directory and Git branch
- active model and thinking level
- accumulated input/output/cache tokens
- context window usage with a colored progress bar
- accumulated input/output/cache/total cost

## Install

```bash
pi install npm:@nilskluewer/pi-statusline
```

## Notes

This package only contains the status line. If you want message wrapping and the live tool
side panel too, use `@nilskluewer/pi-terminal-ui` instead.

## License

MIT
