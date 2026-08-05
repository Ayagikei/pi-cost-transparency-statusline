# @nilskluewer/pi-cost-transparency-statusline

A cost transparency status line for the [Pi coding agent](https://pi.dev/).

![Pi cost transparency status line showing its pastel sci-fi telemetry dashboard](./assets/statusline-preview.png)

It replaces Pi's footer with a compact pastel telemetry dashboard that makes token usage and estimated spend transparent:

- current working directory and Git branch
- active model and thinking level
- accumulated input/output/cache-read/cache-write tokens across the session
- cache hit rate with a colored progress rail
- context window usage with a colored progress rail
- estimated cost breakdown: input, output, cache read, cache write, and total

The dollar values are calculated from Pi's model catalog and are estimates, not provider invoices.
Subscription and gateway providers can use different billing units, allowances, discounts, or rounding.

## Install

```bash
pi install npm:@nilskluewer/pi-cost-transparency-statusline
```

## Notes

This package was previously published as `@nilskluewer/pi-statusline`.
Use this package going forward.

If you want message wrapping and the live tool side panel too, use `@nilskluewer/pi-terminal-ui` instead.

## License

MIT
