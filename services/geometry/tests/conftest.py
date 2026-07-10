import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator

import pytest


def pytest_configure(config: pytest.Config) -> None:
    """Optional shadow-corpus capture (env GEOMETRY_CAPTURE_DIR). No-op otherwise."""
    capture_dir = os.environ.get("GEOMETRY_CAPTURE_DIR")
    if capture_dir:
        from capture_corpus import install

        install(Path(capture_dir))


@pytest.fixture(scope="session")
def step_fixtures(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    """Generate the STEP fixtures once per session (requires OCP)."""
    pytest.importorskip("OCP")
    from fixtures.make_fixtures import build_all

    return build_all(tmp_path_factory.mktemp("step-fixtures"))


class StorageStub:
    def __init__(self, source_bytes: bytes) -> None:
        self.source_bytes = source_bytes
        self.puts: dict[str, bytes] = {}


class _StorageHandler(BaseHTTPRequestHandler):
    storage: StorageStub

    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.storage.source_bytes)))
        self.end_headers()
        self.wfile.write(self.storage.source_bytes)

    def do_PUT(self) -> None:
        length = int(self.headers["Content-Length"])
        self.storage.puts[self.path] = self.rfile.read(length)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args: object) -> None:  # silence test output
        pass


@pytest.fixture
def storage_server(step_fixtures: dict[str, Path]) -> Iterator[tuple[str, StorageStub]]:
    """Local HTTP server playing the signed-URL storage role."""
    storage = StorageStub(step_fixtures["plates"].read_bytes())
    handler = type("Handler", (_StorageHandler,), {"storage": storage})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", storage
    finally:
        server.shutdown()
