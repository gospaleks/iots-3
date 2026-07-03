# ekuiper/ — Streaming / CEP layer (NEW, built in a later iteration)

LF Edge eKuiper stream + rule definitions and a `provision.sh` that POSTs them to the REST API
(port 9081) on startup — reproducible, not hand-created in the UI. Subscribes to
`sensors/telemetry`, applies SQL rules (threshold, windowed, complex/correlation), and sinks
detected events to `sensors/events`. See [docs/REQUIREMENTS-IoTS-3.md §6.1](../docs/REQUIREMENTS-IoTS-3.md)
and the eKuiper deep-dive in [docs/IoTS-3-EXPLAINED.md §4](../docs/IoTS-3-EXPLAINED.md).
