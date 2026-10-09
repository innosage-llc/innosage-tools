# Meeting Fixer processing contract

Meeting Fixer combines the base recording and the recorded amendment entirely
in the browser with `ffmpeg.wasm`. FFmpeg's progress callback includes a
`time` timestamp in microseconds and a ratio that is not reliable for this
two-input concat operation; the UI therefore calculates progress from
`time / 1,000,000` divided by the combined base-plus-amendment duration.

The display uses normalized stage weights:

- preparation/loading: 0–10%;
- FFmpeg processing: 10–90%;
- output finalization/readback: 90–99%;
- ready only after a successful exit and a non-empty readable output: 100%.

When either media duration is missing, zero, non-finite, or otherwise
unreliable, processing remains an honest indeterminate stage instead of
inventing a percentage. Raw outliers, `NaN`, infinity, and negative values do
not become displayed numeric progress. Temporary virtual files are named per
run and removed after success or failure; object URLs are revoked when replaced
or when the component unmounts.
