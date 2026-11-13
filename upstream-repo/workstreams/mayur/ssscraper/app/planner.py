"""Prompt-to-plan agent. AI proposes a bounded research plan; it does not invent leads."""
from __future__ import annotations

import json
import re
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field, field_validator

from .settings import Settings


class PlanRequest(BaseModel):
    prompt: str = Field(min_length=12, max_length=2_000)
    lead_count: int = Field(ge=1, le=500)


class LeadPlan(BaseModel):
    client_goal: str = Field(min_length=1, max_length=500)
    search_queries: list[str] = Field(min_length=1, max_length=15)
    include_terms: list[str] = Field(default_factory=list, max_length=20)
    exclude_terms: list[str] = Field(default_factory=list, max_length=20)
    location_terms: list[str] = Field(default_factory=list, max_length=15)
    target_roles: list[str] = Field(default_factory=list, max_length=15)
    require_named_contact: bool = False
    require_mode: Literal["either", "email", "phone", "both"] = "either"
    plain_filters: list[str] = Field(min_length=2, max_length=10)
    cautions: list[str] = Field(default_factory=list, max_length=8)
    generated_by: Literal["ai", "rule_based_preview"]

    @field_validator("search_queries", "include_terms", "exclude_terms", "location_terms", "target_roles", "plain_filters", "cautions", mode="before")
    @classmethod
    def normalise_and_bound_terms(cls, values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        seen: set[str] = set()
        output: list[str] = []
        for value in values:
            clean = re.sub(r"\s+", " ", str(value)).strip()
            key = clean.lower()
            if clean and key not in seen:
                seen.add(key)
                output.append(clean)
        return output[:15]


class PlanError(RuntimeError):
    pass


PLAN_SYSTEM_PROMPT = """You are an expert B2B Lead Research Planning Agent.
Convert the client's plain-English goal into a high-precision, client-agnostic lead research plan.
Return ONLY a valid JSON object matching this schema:
{
  "client_goal": "Clear plain-English summary of what leads to find",
  "search_queries": ["up to 10 diverse search queries for Maps, web search engines, and LinkedIn"],
  "include_terms": ["industry and positive qualification keywords, max 15"],
  "exclude_terms": ["negative exclusion keywords like consumer retail, portals, max 10"],
  "location_terms": ["geographic keywords, cities, industrial areas, max 8"],
  "target_roles": ["relevant decision-maker job titles if requested, max 8"],
  "require_named_contact": false,
  "require_mode": "either",
  "plain_filters": ["3 to 6 plain-English bullet points for common non-technical business users"],
  "cautions": ["1 to 3 helpful caveats or search notes"],
  "generated_by": "ai"
}
Rules:
- Make diverse queries covering business directories, official sites, and LinkedIn company footprints.
- Do NOT make assumptions specific to any single client or city unless mentioned in the goal.
- plain_filters must be phrased simply for regular business owners, NOT developers (no regex, no CSV, no SQL).
"""


def _fallback(request: PlanRequest) -> LeadPlan:
    words = re.findall(r"[A-Za-z][A-Za-z0-9+&/-]{2,}", request.prompt.lower())
    stop = {"need", "want", "with", "from", "that", "this", "their", "into", "near", "around", "lead", "leads", "company", "companies", "business", "businesses"}
    terms = list(dict.fromkeys(word for word in words if word not in stop))[:8]
    return LeadPlan(
        client_goal=request.prompt.strip(),
        search_queries=[request.prompt.strip()],
        include_terms=terms,
        exclude_terms=["marketplace", "portal", "blog"],
        location_terms=[],
        target_roles=[],
        require_named_contact=False,
        require_mode="either",
        plain_filters=[
            f"Find businesses matching: {request.prompt.strip()}",
            "Verify official business websites for direct evidence.",
            "Extract verified public business phone and email contacts.",
            "Estimate company size and qualification score automatically.",
        ],
        cautions=["Preview plan generated without active AI. Add your AI API key for full generative planning."],
        generated_by="rule_based_preview",
    )


def create_plan(request: PlanRequest, settings: Settings) -> LeadPlan:
    if not settings.lead_ai_api_key:
        return _fallback(request)

    # 1. Try standard OpenAI / OpenRouter Chat Completions endpoint with JSON object mode
    body = {
        "model": settings.lead_ai_model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": PLAN_SYSTEM_PROMPT},
            {"role": "user", "content": f"Client goal: {request.prompt}\nDesired qualified leads: {request.lead_count}"},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    http_request = Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings.lead_ai_api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(http_request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            # Ensure generated_by is ai
            parsed["generated_by"] = "ai"
            # Ensure arrays are safely bounded before Pydantic validation
            for key, limit in [
                ("search_queries", 15),
                ("include_terms", 20),
                ("exclude_terms", 20),
                ("location_terms", 15),
                ("target_roles", 15),
                ("plain_filters", 10),
                ("cautions", 8),
            ]:
                if key in parsed and isinstance(parsed[key], list):
                    parsed[key] = parsed[key][:limit]
            return LeadPlan.model_validate(parsed)
    except Exception as chat_exc:
        # Fallback to responses endpoint if chat completions fails
        try:
            resp_body = {
                "model": settings.lead_ai_model or "gpt-4o-mini",
                "instructions": PLAN_SYSTEM_PROMPT,
                "input": f"Client goal: {request.prompt}\nDesired qualified leads: {request.lead_count}",
            }
            resp_request = Request(
                "https://api.openai.com/v1/responses",
                data=json.dumps(resp_body).encode("utf-8"),
                headers={"Authorization": f"Bearer {settings.lead_ai_api_key}", "Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(resp_request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
                for item in payload.get("output", []):
                    for content_item in item.get("content", []):
                        if content_item.get("type") == "output_text" and isinstance(content_item.get("text"), str):
                            parsed = json.loads(content_item["text"])
                            parsed["generated_by"] = "ai"
                            return LeadPlan.model_validate(parsed)
        except Exception:
            pass
        raise PlanError(f"AI planning failed: {type(chat_exc).__name__}: {chat_exc}") from chat_exc
