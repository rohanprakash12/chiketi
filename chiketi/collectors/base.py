"""MetricCollector ABC and MetricValue dataclass."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MetricValue:
    """A single metric reading."""

    value: Any = None
    unit: str = ""
    available: bool = True
    extra: dict[str, Any] = field(default_factory=dict)


class MetricCollector(ABC):
    """Base class for all metric collectors."""

    namespace: str = ""

    @abstractmethod
    def collect(self) -> dict[str, MetricValue]:
        """Collect metrics. Must never raise - catch internally."""
        ...

    def _key(self, name: str) -> str:
        return f"{self.namespace}.{name}"
