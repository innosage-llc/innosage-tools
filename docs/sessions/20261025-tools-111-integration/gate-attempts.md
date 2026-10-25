# Native gate attempts

1. Initial native submit: required offline product suites reached lint. Lint failed
with 101 errors in generated changes-integration/.generated/runtime.cjs and ui.js.
No commit or PR was created. Raw local log retained; SHA256 4d2eb9ee50d98ab59bcdd3429cead69192a201a10d3e9982668cfe4aa051dcee.
The one-line repair extends the existing precise generated-bundle ignore pattern
to this fixture's .generated directory. Handwritten sources remain linted; no
runtime/source003 bytes change. Independent delta review requested.

Subsequent gate/PR receipts are recorded in the Hub final integration packet.

Independent reviewer delta PASS: generated-only exclusion matches existing spike
policy, hand-written files still linted. Focused npm run lint exit0 (24 existing
warnings, zero errors); 1308 frozen inputs unchanged.
