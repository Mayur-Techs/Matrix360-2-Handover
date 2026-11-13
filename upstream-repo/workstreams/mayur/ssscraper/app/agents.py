"""Deterministic and AI-driven qualification agents for the public-web workflow.

Performs structured qualification, company size estimation, contact validation,
and deduplication to output ready-to-use B2B sales leads.
"""
from __future__ import annotations

import json
import re
import socket
from collections import Counter
from dataclasses import dataclass
from typing import Any, Callable
from urllib.request import Request, urlopen

from .crawler import EMAIL_RE, valid_phone
from .models import CompanyResult, ContactEvidence

try:  # Optional: requirements installs dnspython for MX checks in real runs.
    import dns.resolver
except ImportError:  # pragma: no cover
    dns = None


AGENT_NAMES = (
    "AI planning agent",
    "Discovery & search agent",
    "Candidate intake agent",
    "Official website evidence agent",
    "AI qualification & company size agent",
    "Contact validation agent",
    "Suppression and deduplication agent",
    "Quota and export agent",
)


@dataclass(frozen=True, slots=True)
class FilterPolicy:
    include_terms: tuple[str, ...] = ()
    exclude_terms: tuple[str, ...] = ()
    location_terms: tuple[str, ...] = ()
    suppression_terms: tuple[str, ...] = ()
    allowed_statuses: tuple[str, ...] = ("QUALIFIED", "PREPASS", "REVIEW")
    require_mode: str = "either"
    require_named_contact: bool = False
    target_roles: tuple[str, ...] = ()
    target_qualified_leads: int = 0
    validate_email_domains: bool = True
    client_goal: str = ""


def csv_terms(value: str) -> tuple[str, ...]:
    return tuple(item.strip().lower() for item in re.split(r"[,\r\n]+", value) if item.strip())


def validate_policy(policy: FilterPolicy) -> None:
    if policy.require_mode not in {"either", "email", "phone", "both"}:
        raise ValueError("require_mode must be email, phone, both, or either")
    if not set(policy.allowed_statuses).issubset({"QUALIFIED", "PREPASS", "REVIEW", "EXCLUDE"}):
        raise ValueError("allowed_statuses contains an unknown research status")


class AILeadQualificationAgent:
    """Uses LLM to evaluate match quality, estimate company size, and provide a plain-English rationale."""

    def __init__(self, api_key: str = "", model: str = "gpt-4o-mini") -> None:
        self.api_key = api_key
        self.model = model or "gpt-4o-mini"

    def qualify(self, result: CompanyResult, client_goal: str) -> None:
        joined_text = " ".join(p.text for p in result.pages)[:3500]
        if not self.api_key or not client_goal:
            self._heuristic_qualify(result, client_goal, joined_text)
            return

        system_prompt = (
            "You are an expert B2B Lead Qualification Agent. "
            "Analyze the business and website evidence against the client's goal. "
            "Estimate company size (Startup (1-10), Small (11-50), Medium (51-200), Large (201-1000), Enterprise (1000+)). "
            "Return JSON matching: "
            "{\"fit_status\": \"QUALIFIED\" | \"REVIEW\" | \"EXCLUDE\", "
            "\"fit_score\": 0 to 100, "
            "\"company_size\": \"Size Tier\", "
            "\"qualification_summary\": \"1-2 sentence plain-English summary of fit\", "
            "\"reasons\": [\"short reason\"]}"
        )
        user_prompt = (
            f"Client Goal: {client_goal}\n"
            f"Company Name: {result.seed.company_name}\n"
            f"Domain: {result.seed.domain}\n"
            f"Location Hint: {result.seed.location_hint}\n"
            f"Website Text Evidence: {joined_text}"
        )
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        }
        try:
            req = Request(
                "https://api.openai.com/v1/chat/completions",
                data=json.dumps(body).encode("utf-8"),
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = json.loads(data["choices"][0]["message"]["content"])
                status = content.get("fit_status", "REVIEW").upper()
                if status in {"QUALIFIED", "REVIEW", "EXCLUDE"}:
                    result.fit_status = status
                score = content.get("fit_score")
                if isinstance(score, (int, float)):
                    result.fit_score = max(0, min(100, int(score)))
                if content.get("company_size"):
                    result.company_size = str(content["company_size"])
                if content.get("qualification_summary"):
                    result.qualification_summary = str(content["qualification_summary"])
                if content.get("reasons") and isinstance(content["reasons"], list):
                    result.reasons = [str(r) for r in content["reasons"][:5]]
        except Exception:
            self._heuristic_qualify(result, client_goal, joined_text)

    def _heuristic_qualify(self, result: CompanyResult, client_goal: str, text: str) -> None:
        if result.fit_status == "PREPASS":
            result.fit_status = "QUALIFIED"
            result.fit_score = 85
            result.qualification_summary = f"{result.seed.company_name} matches the requested industry focus and operational profile."
        elif result.fit_status == "REVIEW":
            result.fit_score = 55
            result.qualification_summary = f"{result.seed.company_name} has relevant public business indicators but needs review."
        elif result.fit_status == "EXCLUDE":
            result.fit_score = 15
            result.qualification_summary = f"{result.seed.company_name} does not match the target criteria."


class ContactValidationAgent:
    """Labels syntax, format, and MX/DNS observability without asserting guaranteed inbox delivery."""

    def __init__(self) -> None:
        self._mx_cache: dict[str, str] = {}

    def validate(self, contact: ContactEvidence, validate_domains: bool) -> ContactEvidence:
        contact.phone_validation = "format_valid" if contact.company_phone and valid_phone(contact.company_phone) else ("missing" if not contact.company_phone else "format_invalid")
        if not contact.company_email:
            contact.email_validation = "missing"
        elif not EMAIL_RE.fullmatch(contact.company_email):
            contact.email_validation = "syntax_invalid"
        elif not validate_domains:
            contact.email_validation = "syntax_valid_not_checked"
        else:
            contact.email_validation = self._mx_status(contact.company_email.rsplit("@", 1)[1])
        return contact

    def _mx_status(self, domain: str) -> str:
        domain = domain.lower()
        if domain in self._mx_cache:
            return self._mx_cache[domain]
        status = "domain_not_resolved"
        if dns is not None:
            try:
                if dns.resolver.resolve(domain, "MX", lifetime=2.0):
                    status = "mx_present_not_deliverability_verified"
            except Exception:
                pass
        if status == "domain_not_resolved":
            try:
                socket.getaddrinfo(domain, None)
                status = "domain_resolves_mx_not_checked"
            except OSError:
                pass
        self._mx_cache[domain] = status
        return status


def contact_matches(policy: FilterPolicy, contact: ContactEvidence) -> tuple[bool, str | None]:
    has_email = contact.email_validation.startswith("mx_present") or contact.email_validation.startswith("domain_resolves") or contact.email_validation.startswith("syntax_valid")
    has_phone = contact.phone_validation == "format_valid"
    if policy.require_mode == "email" and not has_email:
        return False, "missing requested email evidence"
    if policy.require_mode == "phone" and not has_phone:
        return False, "missing requested phone evidence"
    if policy.require_mode == "both" and not (has_email and has_phone):
        return False, "missing requested email-and-phone evidence"
    if policy.require_mode == "either" and not (has_email or has_phone):
        return False, "missing public email or phone evidence"
    if policy.require_named_contact and not contact.named_contact:
        return False, "named professional contact required"
    if policy.require_named_contact and policy.target_roles and (
        not contact.role or not any(term in contact.role.lower() for term in policy.target_roles)
    ):
        return False, "role does not match target-role filter"
    return True, None


def run_agents(
    results: list[CompanyResult],
    policy: FilterPolicy,
    event: Callable[[str, dict], None],
    ai_key: str = "",
    ai_model: str = "gpt-4o-mini",
) -> dict:
    """Apply qualification and filtering while retaining each source company and rejection reason."""
    validate_policy(policy)
    ai_qualifier = AILeadQualificationAgent(api_key=ai_key, model=ai_model)
    validator = ContactValidationAgent()
    rejections: Counter[str] = Counter()
    raw_contacts = 0
    accepted_contacts = 0
    seen: set[tuple[str, str, str]] = set()

    event("agent_started", {"agent": "AI qualification & company size agent"})
    for result in results:
        # Run AI qualification on company if pages exist
        if result.pages and not result.error:
            ai_qualifier.qualify(result, policy.client_goal)

        combined = " ".join((
            result.seed.company_name,
            result.seed.location_hint,
            " ".join(result.reasons),
            " ".join(result.exclusion_reasons),
            result.qualification_summary,
        )).lower()

        if result.fit_status not in policy.allowed_statuses:
            result.filter_rejections.append(f"research status {result.fit_status} not allowed")
            rejections["research status not allowed"] += 1
        if policy.include_terms and not any(term in combined for term in policy.include_terms):
            result.filter_rejections.append("does not match requested industry include terms")
            rejections["industry include mismatch"] += 1
        if policy.exclude_terms and any(term in combined for term in policy.exclude_terms):
            result.filter_rejections.append("matches requested exclusion term")
            rejections["requested exclusion"] += 1
        location = f"{result.seed.location_hint} {result.geographic_evidence}".lower()
        if policy.location_terms and not any(term in location for term in policy.location_terms):
            result.filter_rejections.append("does not match requested geography")
            rejections["geography mismatch"] += 1
        if result.seed.domain.lower() in policy.suppression_terms or result.seed.source_id.lower() in policy.suppression_terms:
            result.filter_rejections.append("matches suppression list")
            rejections["suppression list"] += 1
    event("agent_finished", {"agent": "AI qualification & company size agent"})

    event("agent_started", {"agent": "Contact validation agent"})
    for result in results:
        raw_contacts += len(result.contacts)
        original = result.contacts
        result.contacts = []
        if result.filter_rejections:
            rejections["company-level filter"] += len(original)
            continue
        for contact in original:
            # Sync AI qualification attributes to contact row
            contact.fit_score = result.fit_score
            contact.company_size = result.company_size
            contact.qualification_summary = result.qualification_summary
            contact.fit_status = result.fit_status
            contact.linkedin_url = result.linkedin_url or contact.linkedin_url

            validator.validate(contact, policy.validate_email_domains)
            email = contact.company_email.lower()
            phone = re.sub(r"\D", "", contact.company_phone)
            if any(term in {result.seed.domain.lower(), result.seed.source_id.lower(), email, phone} for term in policy.suppression_terms):
                rejections["suppression list"] += 1
                continue
            allowed, reason = contact_matches(policy, contact)
            if not allowed:
                rejections[reason or "contact filter"] += 1
                continue
            key = (contact.domain.lower(), email, phone)
            if key in seen and (email or phone):
                rejections["duplicate contact evidence"] += 1
                continue
            seen.add(key)
            result.contacts.append(contact)
            accepted_contacts += 1
    event("agent_finished", {"agent": "Contact validation agent"})

    target_met = not policy.target_qualified_leads or accepted_contacts >= policy.target_qualified_leads
    event("agent_finished", {"agent": "Suppression and deduplication agent", "duplicates_removed": rejections["duplicate contact evidence"]})
    event("agent_finished", {"agent": "Quota and export agent", "qualified_contacts": accepted_contacts, "target": policy.target_qualified_leads, "target_met": target_met})

    return {
        "agents": list(AGENT_NAMES),
        "raw_contact_rows": raw_contacts,
        "qualified_contact_rows": accepted_contacts,
        "target_qualified_leads": policy.target_qualified_leads,
        "target_met": target_met,
        "contact_requirement": policy.require_mode,
        "allowed_statuses": list(policy.allowed_statuses),
        "rejections": dict(sorted(rejections.items())),
        "validation_note": "MX/DNS checks confirm domain existence; lead qualification and company size are evidence-evaluated.",
    }
