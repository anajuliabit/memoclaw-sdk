"""CrewAI integration for MemoClaw.

Provides:
- :class:`MemoClawStoreTool` — CrewAI tool for storing memories
- :class:`MemoClawRecallTool` — CrewAI tool for recalling memories

Install with::

    pip install memoclaw[crewai]

Example::

    from crewai import Agent, Task, Crew
    from memoclaw import MemoClaw
    from memoclaw.integrations.crewai import MemoClawStoreTool, MemoClawRecallTool

    client = MemoClaw(private_key="0x...")

    store_tool = MemoClawStoreTool(client=client, namespace="support")
    recall_tool = MemoClawRecallTool(client=client, namespace="support")

    agent = Agent(
        role="Support Agent",
        goal="Help users and remember their preferences",
        backstory="You are a helpful support agent with long-term memory.",
        tools=[store_tool, recall_tool],
    )

    task = Task(
        description="Remember that the user prefers dark mode.",
        agent=agent,
        expected_output="Confirmation that the preference was stored.",
    )

    crew = Crew(agents=[agent], tasks=[task])
    result = crew.kickoff()
"""

from __future__ import annotations

import json
from typing import Any, Type

from pydantic import BaseModel, Field

try:
    from crewai.tools import BaseTool
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "CrewAI integration requires the 'crewai' package. "
        "Install it with: pip install memoclaw[crewai]"
    ) from exc

from memoclaw.client import MemoClaw


class _StoreMemoryInput(BaseModel):
    """Input schema for the MemoClaw store tool."""

    content: str = Field(..., description="The memory content to store.")
    importance: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Importance score between 0 and 1. Higher = more important.",
    )
    tags: list[str] | None = Field(
        default=None,
        description="Tags to categorize the memory.",
    )


class _RecallMemoryInput(BaseModel):
    """Input schema for the MemoClaw recall tool."""

    query: str = Field(..., description="Natural language query to search memories.")
    limit: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Maximum number of memories to return.",
    )
    min_similarity: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Minimum similarity threshold (0-1).",
    )
    tags: list[str] | None = Field(
        default=None,
        description="Filter results to memories with these tags.",
    )


class MemoClawStoreTool(BaseTool):
    """CrewAI tool that stores memories in MemoClaw.

    Args:
        client: A configured :class:`~memoclaw.MemoClaw` instance.
        namespace: Default namespace for stored memories.
        session_id: Default session identifier.
        agent_id: Default agent identifier.
        default_tags: Tags applied to every store call when none are provided.
        name: Tool name exposed to the agent.
        description: Tool description exposed to the agent.
    """

    name: str = "memoclaw_store_memory"
    description: str = (
        "Store a piece of information in long-term memory for future recall. "
        "Use this when the user shares preferences, facts, corrections, or anything "
        "worth remembering across conversations."
    )
    args_schema: Type[BaseModel] = _StoreMemoryInput

    # Instance config — not exposed to the LLM
    client: Any = Field(exclude=True)
    namespace: str | None = Field(default=None, exclude=True)
    session_id: str | None = Field(default=None, exclude=True)
    agent_id: str | None = Field(default=None, exclude=True)
    default_tags: list[str] | None = Field(default=None, exclude=True)

    model_config = {"arbitrary_types_allowed": True}

    def _run(
        self,
        content: str,
        importance: float | None = None,
        tags: list[str] | None = None,
    ) -> str:
        resolved_tags = tags if tags is not None else self.default_tags
        result = self.client.store(
            content,
            importance=importance,
            tags=resolved_tags,
            namespace=self.namespace,
            session_id=self.session_id,
            agent_id=self.agent_id,
        )
        return json.dumps(result.model_dump(), default=str)


class MemoClawRecallTool(BaseTool):
    """CrewAI tool that recalls memories from MemoClaw.

    Args:
        client: A configured :class:`~memoclaw.MemoClaw` instance.
        namespace: Default namespace to search.
        session_id: Default session filter.
        agent_id: Default agent filter.
        name: Tool name exposed to the agent.
        description: Tool description exposed to the agent.
    """

    name: str = "memoclaw_recall_memories"
    description: str = (
        "Search long-term memory for information relevant to a query. "
        "Use this to retrieve previously stored facts, preferences, or context "
        "before answering questions."
    )
    args_schema: Type[BaseModel] = _RecallMemoryInput

    # Instance config
    client: Any = Field(exclude=True)
    namespace: str | None = Field(default=None, exclude=True)
    session_id: str | None = Field(default=None, exclude=True)
    agent_id: str | None = Field(default=None, exclude=True)

    model_config = {"arbitrary_types_allowed": True}

    def _run(
        self,
        query: str,
        limit: int = 5,
        min_similarity: float | None = None,
        tags: list[str] | None = None,
    ) -> str:
        response = self.client.recall(
            query,
            limit=limit,
            min_similarity=min_similarity,
            namespace=self.namespace,
            tags=tags,
            session_id=self.session_id,
            agent_id=self.agent_id,
        )
        return json.dumps(response.model_dump(), default=str)


__all__ = [
    "MemoClawStoreTool",
    "MemoClawRecallTool",
]
