# maas/ — Model-as-a-Service (NEW, built in a later iteration)

Python + FastAPI service hosting a trained ML model behind REST — `POST /predict`,
`GET /health`, `GET /model/info` — plus a reproducible `train.py` (train/validation/test split,
reported metrics, serialized artifact). Analytics calls it over REST; MaaS never touches the
broker. See [docs/REQUIREMENTS-IoTS-3.md §6.2](../docs/REQUIREMENTS-IoTS-3.md) and
[docs/IoTS-3-EXPLAINED.md §5](../docs/IoTS-3-EXPLAINED.md).
