"""nora_core.affordance — affordance scoring and execution sub-package.

Provides:
- :class:`AffordanceScore`: Canonical scored affordance data structure
- :class:`BaseScorer`: Abstract base affordance scorer
- :class:`AffordanceScorer`: Production physical & semantic affordance scorer
- :class:`WeightedProductFusion`: Geometric product score fusion
- :class:`AffordanceMetricsLogger`: Metrics accumulator and CSV exporter
- :class:`WorldState`, :class:`RobotState`, :class:`WorldObject`: Environmental context
- :class:`AffordanceWorkflow`, :class:`WorkflowResult`: End-to-end task execution pipeline
- :class:`SayCanPlanner`, :class:`SayCanScorer`, :class:`SayCanPlan`: Google Research SayCan engine
"""

from __future__ import annotations

from nora_core.affordance.environment import Location, RobotState, WorldObject, WorldState
from nora_core.affordance.fusion import WeightedProductFusion
from nora_core.affordance.metrics import AffordanceMetricsLogger
from nora_core.affordance.saycan import (
    SAYCAN_EXEMPLARS,
    SayCanOption,
    SayCanPlan,
    SayCanPlanner,
    SayCanScorer,
    SayCanStepResult,
)
from nora_core.affordance.scoring import AffordanceScore, AffordanceScorer, BaseScorer
from nora_core.affordance.workflow import AffordanceWorkflow, WorkflowResult

__all__ = [
    "AffordanceMetricsLogger",
    "AffordanceScore",
    "AffordanceScorer",
    "AffordanceWorkflow",
    "BaseScorer",
    "Location",
    "RobotState",
    "SAYCAN_EXEMPLARS",
    "SayCanOption",
    "SayCanPlan",
    "SayCanPlanner",
    "SayCanScorer",
    "SayCanStepResult",
    "WeightedProductFusion",
    "WorkflowResult",
    "WorldObject",
    "WorldState",
]

