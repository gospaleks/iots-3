"""Describe eKuiper's window shape for the web app (`GET /api/window`).

Analytics does no windowing (D9) — it just reports the WINDOW_* config it shares with
`ekuiper-provision` through compose's `.env`, mapped to the seconds + label the dashboard
header renders. Doing the unit maths here keeps the frontend free of eKuiper vocabulary.

Deliberately not derived from the event stream: eKuiper 2.2.1 sometimes merges two windows
into one double-width emission (see shared/thresholds.md), so observed widths lie. The
config does not.
"""
from __future__ import annotations

from .config import Config

# eKuiper time units → seconds (see WINDOW_UNIT in docker/.env.example).
_UNIT_SECONDS: dict[str, float] = {"ms": 0.001, "ss": 1, "mi": 60, "hh": 3600, "dd": 86400}


def _seconds(unit: str, value: int | None) -> float | None:
    factor = _UNIT_SECONDS.get(unit)
    if factor is None or value is None:
        return None
    return value * factor


def _fmt(sec: float) -> str:
    """Humanise a duration — a 30mi window should read `30m`, not `1800s`."""
    for limit, factor, suffix in ((86400, 86400, "d"), (3600, 3600, "h"), (60, 60, "m")):
        if sec >= limit and sec % factor == 0:
            return f"{sec / factor:g}{suffix}"
    return f"{sec:g}s"


def window_info(cfg: Config) -> dict:
    wtype = cfg.window_type

    # COUNTWINDOW counts messages, not time — size/step are not durations.
    if wtype == "count":
        step = f" / {cfg.window_step}" if cfg.window_step else ""
        return {
            "type": wtype,
            "unit": None,
            "size": cfg.window_size,
            "step": cfg.window_step,
            "width_sec": None,
            "step_sec": None,
            "overlapping": cfg.window_step is not None,
            "label": f"count · {cfg.window_size}{step} msg",
        }

    width_sec = _seconds(cfg.window_unit, cfg.window_size)
    step_sec = _seconds(cfg.window_unit, cfg.window_step)

    # Only hopping genuinely tiles with a gap smaller than its width. A sliding window
    # re-emits per incoming message (its step is a trigger delay, not a hop) so it always
    # overlaps; a session window's step is maxDuration and sessions never overlap.
    if wtype == "sliding":
        overlapping = True
    elif wtype == "hopping":
        overlapping = width_sec is not None and step_sec is not None and step_sec < width_sec
    else:
        overlapping = False

    if width_sec is None:
        label = f"{wtype} · {cfg.window_size}{cfg.window_unit}"  # unknown unit — show it raw
    elif step_sec is not None and wtype in ("hopping", "session"):
        label = f"{wtype} · {_fmt(width_sec)} / {_fmt(step_sec)}"
    else:
        label = f"{wtype} · {_fmt(width_sec)}"

    return {
        "type": wtype,
        "unit": cfg.window_unit,
        "size": cfg.window_size,
        "step": cfg.window_step,
        "width_sec": width_sec,
        "step_sec": step_sec,
        "overlapping": overlapping,
        "label": label,
    }
