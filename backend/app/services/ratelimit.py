"""A sliding-window token budget.

Groq's free tier allows 8,000 tokens per minute per organisation, and the
allowance counts the requested completion size as well as the prompt. Firing
concurrent batches at it just produces a wall of 413s, so every request books
its estimated cost here first and waits its turn if the minute is spent.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque

# How often a waiting caller rechecks the budget. Must be short: a batch that
# finishes early refunds its unused reservation, and a waiter should notice
# within a beat or two -- not sleep out a near-full 60s window regardless.
_POLL_INTERVAL = 1.2


class TokenBudget:
    """Allows `limit` tokens per `window` seconds, waiting when the budget is out."""

    def __init__(self, limit: int, window: float = 60.0, safety: float = 0.9) -> None:
        self.limit = max(1, int(limit * safety))
        self.window = window
        self._spent: deque[tuple[float, int]] = deque()
        self._lock = asyncio.Lock()
        self.waited_seconds = 0.0

    def _prune(self, now: float) -> None:
        while self._spent and now - self._spent[0][0] > self.window:
            self._spent.popleft()

    def _in_flight(self) -> int:
        return sum(amount for _, amount in self._spent)

    async def acquire(self, tokens: int) -> float:
        """Books `tokens`; returns how long the caller had to wait.

        Rechecks the budget every `_POLL_INTERVAL` seconds rather than
        sleeping out the full window in one shot, so a booking freed early by
        another caller's refund (or by simply completing) is picked up almost
        immediately instead of after up to a minute of dead time.
        """
        tokens = min(tokens, self.limit)
        waited = 0.0
        while True:
            async with self._lock:
                now = time.monotonic()
                self._prune(now)
                if self._in_flight() + tokens <= self.limit:
                    self._spent.append((now, tokens))
                    self.waited_seconds += waited
                    return waited
            await asyncio.sleep(_POLL_INTERVAL)
            waited += _POLL_INTERVAL

    def refund(self, tokens: int) -> None:
        """Give back an over-estimate so the next caller is not starved."""
        if tokens <= 0:
            return
        # Shrink the most recent booking(s) rather than assuming the caller's
        # own entry is still last -- other tasks may have booked since.
        remaining = tokens
        for index in range(len(self._spent) - 1, -1, -1):
            if remaining <= 0:
                break
            stamp, amount = self._spent[index]
            take = min(amount, remaining)
            self._spent[index] = (stamp, amount - take)
            remaining -= take


def estimate_tokens(text: str) -> int:
    """Rough prompt sizing. Code packs denser than prose, so ~3.3 chars/token."""
    return int(len(text) / 3.3) + 8
