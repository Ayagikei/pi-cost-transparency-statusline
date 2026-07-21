# @nilskluewer/pi-cost-transparency-statusline

A cost transparency status line for the [Pi coding agent](https://pi.dev/).

It replaces Pi's footer with a compact multi-line view that makes token usage and spend
fully transparent:

- current working directory and Git branch
- active model and thinking level
- accumulated input/output/cache-read/cache-write tokens
- cache hit rate
- context window usage with a colored progress bar
- full cost breakdown: input, output, cache read, cache write, and total

## Install

```bash
pi install npm:@nilskluewer/pi-cost-transparency-statusline
```

## Notes

This package was previously published as `@nilskluewer/pi-statusline`.
Use this package going forward.

If you want message wrapping and the live tool side panel too, use
`@nilskluewer/pi-terminal-ui` instead.

## License

MIT
