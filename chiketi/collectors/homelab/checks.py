"""Talking to the hosts. Every check is read-only and time-boxed."""

from __future__ import annotations

import json
import socket
import subprocess
import urllib.error
import urllib.request

from chiketi.collectors.homelab.config import HomelabConfig, Host
from chiketi.collectors.homelab.probe import ProbeError, ProbeReport, parse_probe
from chiketi.collectors.homelab.rules import HOLD_DOWN, Condition, down

MAX_BODY = 4 * 1024 * 1024


class CheckError(Exception):
    """A check could not get an answer. str() is shown as the issue detail."""


def run_probe(host: Host, cfg: HomelabConfig, runner=subprocess.run,
              timeout: float = 30.0) -> ProbeReport:
    cmd = ["ssh", "-i", cfg.ssh_key, "-p", str(host.port),
           "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
           "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={cfg.known_hosts}",
           "-o", "LogLevel=ERROR", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
           f"{host.user}@{host.address}", "chiketi-probe"]
    try:
        r = runner(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise CheckError("timed out") from None
    except OSError as exc:
        raise CheckError(f"cannot run ssh: {exc}") from None
    if r.returncode != 0:
        err = (r.stderr or "").lower()
        if "host key verification failed" in err or "host identification has changed" in err:
            raise CheckError("host key mismatch")
        if "permission denied" in err:
            raise CheckError("key refused")
        if "no route" in err or "timed out" in err or "refused" in err:
            raise CheckError("no connection")
        raise CheckError(f"ssh exit {r.returncode}")
    try:
        return parse_probe(r.stdout)
    except ProbeError:
        raise CheckError("probe output unreadable") from None


def _tcp(connect, ip: str, port: int) -> bool:
    try:
        s = connect((ip, port), timeout=3.0)
    except OSError:
        return False
    try:
        s.close()
    except OSError:
        pass
    return True


def evaluate_gateway(host: Host, connect=socket.create_connection,
                     resolve=socket.getaddrinfo) -> list[Condition]:
    # TCP 53 rather than ping: the service runs with NoNewPrivileges, which
    # strips ping's file capability.
    if not _tcp(connect, host.address, 53):
        return [Condition("gw", "crit", "Gateway unreachable", f"{host.address} not answering", HOLD_DOWN)]
    out = []
    if not _tcp(connect, host.outside_ip, 443):
        out.append(Condition("wan", "crit", "Internet unreachable", f"cannot reach {host.outside_ip}", HOLD_DOWN))
    try:
        ok = bool(resolve(host.dns_name, 443))
    except OSError:
        ok = False
    if not ok:
        out.append(Condition("dns", "crit", "DNS failing", f"cannot resolve {host.dns_name}", HOLD_DOWN))
    return out


def _token(host: Host) -> str:
    if not host.token_file:
        return ""
    try:
        with open(host.token_file) as f:
            return f.read().strip()
    except OSError:
        return ""


def evaluate_http(host: Host, opener=urllib.request.urlopen) -> list[Condition]:
    req = urllib.request.Request(host.url)
    tok = _token(host)
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    try:
        resp = opener(req, timeout=5.0)
        status = getattr(resp, "status", 200)
        resp.close()
    except urllib.error.HTTPError as exc:
        status = exc.code
    except (urllib.error.URLError, OSError) as exc:
        return [down(str(getattr(exc, "reason", exc)))]
    if status != 200:
        return [Condition("down", "crit", f"API answered {status}", host.url, HOLD_DOWN)]
    return []


def fetch_json(url: str, opener=urllib.request.urlopen, timeout: float = 5.0) -> dict:
    try:
        resp = opener(urllib.request.Request(url), timeout=timeout)
        body = resp.read(MAX_BODY)
        resp.close()
        data = json.loads(body)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise CheckError(f"status unavailable: {exc}") from None
    if not isinstance(data, dict):
        raise CheckError("status unavailable: not an object")
    return data
