"""Run core.harvest against a scripted API so JS and Python outputs can be compared."""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core import HarvestConfig, harvest  # noqa: E402


def param_key(params: dict) -> str:
    items = [(k, "" if v is None else str(v)) for k, v in params.items()]
    items.sort()
    return "&".join(f"{k}={v}" for k, v in items)


class FakeResponse:
    def __init__(self, status: int, text: str):
        self.status_code = status
        self.text = text

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            err = requests.HTTPError(f"{self.status_code} Error")
            err.response = self
            raise err


class FakeSession:
    def __init__(self, routes: dict[str, list]):
        self.routes = {key: list(queue) for key, queue in routes.items()}
        self.headers: dict = {}
        self.calls: list[dict] = []

    def get(self, url, params=None, timeout=None):
        params = dict(params or {})
        self.calls.append(params)
        key = param_key(params)
        queue = self.routes.get(key)
        if not queue:
            return FakeResponse(200, json.dumps({"kind": "books#volumes", "totalItems": 0, "items": []}))
        spec = queue.pop(0) if len(queue) > 1 else queue[0]
        body = spec["body"]
        text = body if isinstance(body, str) else json.dumps(body)
        return FakeResponse(spec.get("status", 200), text)


def main() -> int:
    payload = json.loads(sys.stdin.read())
    cfg = HarvestConfig(**payload["config"])
    stamps = payload["timestamps"]
    sleeps: list[float] = []

    class FakeDateTime(datetime):
        _i = 0

        @classmethod
        def now(cls, tz=None):
            value = datetime.fromisoformat(stamps[min(cls._i, len(stamps) - 1)])
            cls._i += 1
            return value

    session = FakeSession(payload["routes"])
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        with patch("core.datetime", FakeDateTime), patch("core.time.sleep", lambda s: sleeps.append(s)):
            result = harvest(cfg, out, session=session, log=lambda *_: None)
        files = {}
        for path in out.rglob("*"):
            if path.is_file():
                files[str(path.relative_to(out)).replace("\\", "/")] = path.read_bytes().decode("utf-8")
    json.dump(
        {
            "files": files,
            "counts": result["counts"],
            "metadata": result["metadata"],
            "sleeps": sleeps,
            "calls": [{k: ("" if v is None else str(v)) for k, v in c.items()} for c in session.calls],
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
