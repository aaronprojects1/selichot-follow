"""Exercise the real web UI through an already-running Chrome CDP endpoint."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

import websocket


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--seconds", type=float, default=18)
    parser.add_argument("--inspect-layout", action="store_true")
    parser.add_argument("--dump-prayers", action="store_true")
    parser.add_argument("--prayer-start", type=int, default=0)
    parser.add_argument("--prayer-count", type=int)
    parser.add_argument("--find-prayer")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--expect-reference")
    parser.add_argument("--expect-no-move", action="store_true")
    parser.add_argument("--screenshot")
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--center-current", action="store_true")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int, default=844)
    args = parser.parse_args()

    with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json") as response:
        targets = json.load(response)
    page = next(
        target for target in targets
        if target.get("type") == "page" and target.get("url", "").startswith(("http://", "https://"))
    )
    socket = websocket.create_connection(page["webSocketDebuggerUrl"])
    request_id = 0

    def evaluate(expression: str):
        nonlocal request_id
        request_id += 1
        socket.send(json.dumps({
            "id": request_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True},
        }))
        while True:
            message = json.loads(socket.recv())
            if message.get("id") == request_id:
                return message.get("result", {}).get("result", {}).get("value")

    if args.width:
        request_id += 1
        socket.send(json.dumps({
            "id": request_id,
            "method": "Emulation.setDeviceMetricsOverride",
            "params": {
                "width": args.width,
                "height": args.height,
                "deviceScaleFactor": 1,
                "mobile": True,
            },
        }))
        while json.loads(socket.recv()).get("id") != request_id:
            pass
        time.sleep(0.5)

    if args.reload:
        evaluate("location.reload(); true")
        time.sleep(0.5)

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        total = evaluate("document.querySelector('#total-count')?.textContent")
        if total and int(total) > 100:
            break
        time.sleep(0.25)

    if args.center_current:
        evaluate("document.querySelector('#jump-current')?.click(); true")
        time.sleep(0.5)

    if args.screenshot:
        request_id += 1
        socket.send(json.dumps({
            "id": request_id,
            "method": "Page.captureScreenshot",
            "params": {"format": "png", "captureBeyondViewport": False},
        }))
        while True:
            message = json.loads(socket.recv())
            if message.get("id") == request_id:
                encoded = message.get("result", {}).get("data", "")
                Path(args.screenshot).write_bytes(base64.b64decode(encoded))
                print(args.screenshot)
                socket.close()
                return

    if args.inspect_layout:
        print(evaluate("""
          JSON.stringify(Object.fromEntries([
            ['viewport', [document.documentElement.clientWidth, document.documentElement.scrollWidth]],
            ...['.site-shell', '.experience', '.reader', '.reader__scroll', '.prayer-list', '.prayer-card', '.prayer-card.is-current', '.prayer-card__hebrew']
              .map(selector => {
                const element = document.querySelector(selector);
                const rect = element?.getBoundingClientRect();
                return [selector, rect && {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, index: element.dataset.index}];
              })
          ]))
        """))
        socket.close()
        return

    if args.dump_prayers:
        print(evaluate(f"""
          JSON.stringify([...document.querySelectorAll('.prayer-card')]
            .slice({args.prayer_start}, {args.prayer_start + args.prayer_count if args.prayer_count else 'undefined'})
            .map((card, offset) => ({{
            index: {args.prayer_start} + offset,
            hebrew: card.querySelector('.prayer-card__hebrew')?.textContent || '',
            title: card.querySelector('.prayer-card__title')?.textContent || ''
          }})))
        """))
        socket.close()
        return

    if args.find_prayer:
        query = json.dumps(args.find_prayer, ensure_ascii=False)
        print(evaluate(f"""
          JSON.stringify([...document.querySelectorAll('.prayer-card')]
            .map((card, index) => ({{
              index,
              hebrew: card.querySelector('.prayer-card__hebrew')?.textContent || '',
              title: card.querySelector('.prayer-card__title')?.textContent || ''
            }}))
            .filter(line => line.hebrew.normalize('NFD').replace(/[\u0591-\u05c7]/g, '').includes(
              {query}.normalize('NFD').replace(/[\u0591-\u05c7]/g, '')
            )))
        """))
        socket.close()
        return

    if evaluate("document.querySelector('#listen-button')?.classList.contains('is-live')"):
        evaluate("document.querySelector('#listen-button').click()")
        time.sleep(0.5)
    evaluate("document.querySelector('#listen-button').click()")
    started = time.monotonic()
    snapshots = []
    while time.monotonic() - started <= args.seconds:
        snapshot = evaluate("""
          JSON.stringify({
            elapsed: performance.now(),
            current: document.querySelector('#current-count')?.textContent,
            total: document.querySelector('#total-count')?.textContent,
            status: document.querySelector('#status-text')?.textContent,
            detail: document.querySelector('#status-subtext')?.textContent,
            heard: document.querySelector('#heard-text')?.innerText,
            live: document.querySelector('#listen-button')?.classList.contains('is-live'),
            acoustic: globalThis.__selichotAudioDebug || null
          })
        """)
        parsed = json.loads(snapshot)
        parsed["wallSeconds"] = round(time.monotonic() - started, 3)
        snapshots.append(parsed)
        if not args.summary:
            print(f"{time.monotonic() - started:5.1f}s {snapshot}", flush=True)
        time.sleep(0.75)

    evaluate("document.querySelector('#listen-button').click()")
    socket.close()

    if args.summary:
        audible = next((item for item in snapshots if (item.get("acoustic") or {}).get("microphone", {}).get("rms", 0) > 0.003), None)
        stable = [item for item in snapshots if (item.get("acoustic") or {}).get("stable")]
        expected = next((
            item for item in snapshots
            if args.expect_reference in (item.get("acoustic") or {}).get("referenceId", "")
            and (
                (item.get("acoustic") or {}).get("stable")
                or (
                    (item.get("acoustic") or {}).get("locked")
                    and item.get("current") != snapshots[0].get("current")
                )
            )
        ), None) if args.expect_reference else None
        summary = {
            "initialCurrent": snapshots[0].get("current") if snapshots else None,
            "finalCurrent": snapshots[-1].get("current") if snapshots else None,
            "audibleAtSeconds": audible.get("wallSeconds") if audible else None,
            "firstStableAtSeconds": stable[0].get("wallSeconds") if stable else None,
            "lockAfterAudibleSeconds": round(
                expected["wallSeconds"] - audible["wallSeconds"], 3
            ) if expected and audible else None,
            "stableReferences": sorted({
                (item.get("acoustic") or {}).get("referenceId", "") for item in stable
            }),
            "visitedLines": list(dict.fromkeys(item.get("current") for item in snapshots)),
            "finalStatus": snapshots[-1].get("status") if snapshots else None,
            "coverage": (snapshots[-1].get("acoustic") or {}).get("references", {}).get("coverage", []) if snapshots else []
        }
        print(json.dumps(summary, ensure_ascii=False))
        if args.expect_reference and not expected:
            raise SystemExit(f"Expected a stable {args.expect_reference!r} match")
        if args.expect_no_move and len(summary["visitedLines"]) > 1:
            raise SystemExit(f"Unexpected line movement: {summary['visitedLines']}")


if __name__ == "__main__":
    main()
