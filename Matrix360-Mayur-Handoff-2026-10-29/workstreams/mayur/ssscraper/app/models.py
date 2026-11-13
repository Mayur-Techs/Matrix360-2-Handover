from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class CompanySeed:
    company_name: str
    domain: str
    source_url: str
    source_id: str
    location_hint: str = ""
    linkedin_url: str = ""


@dataclass(slots=True)
class PageEvidence:
    url: str
    final_url: str
    status: int | None
    title: str
    text: str
    screenshot: str | None = None


@dataclass(slots=True)
class ContactEvidence:
    company_name: str
    domain: str
    fit_status: str
    fit_confidence: str
    company_phone: str = ""
    company_email: str = ""
    named_contact: str = ""
    role: str = ""
    contact_person_email: str = ""
    contact_person_phone: str = ""
    address: str = ""
    location_type: str = ""
    source_location_hint: str = ""
    sector_description: str = ""
    facility_evidence: str = ""
    research_fit_reasons: str = ""
    source_url: str = ""
    source_page_title: str = ""
    email_validation: str = "not_checked"
    phone_validation: str = "not_checked"
    fit_score: int = 50
    company_size: str = "Unknown"
    qualification_summary: str = ""
    linkedin_url: str = ""

    def row(self) -> dict[str, str]:
        return {key: str(value) for key, value in asdict(self).items()}


@dataclass(slots=True)
class CompanyResult:
    seed: CompanySeed
    fit_status: str
    fit_confidence: str
    reasons: list[str] = field(default_factory=list)
    exclusion_reasons: list[str] = field(default_factory=list)
    geographic_evidence: list[str] = field(default_factory=list)
    pages: list[PageEvidence] = field(default_factory=list)
    contacts: list[ContactEvidence] = field(default_factory=list)
    fit_score: int = 50
    company_size: str = "Unknown"
    qualification_summary: str = ""
    linkedin_url: str = ""
    error: str | None = None
    filter_rejections: list[str] = field(default_factory=list)

    def report(self) -> dict[str, Any]:
        return {
            "company_name": self.seed.company_name,
            "domain": self.seed.domain,
            "source_id": self.seed.source_id,
            "source_url": self.seed.source_url,
            "fit_status": self.fit_status,
            "fit_confidence": self.fit_confidence,
            "fit_score": self.fit_score,
            "company_size": self.company_size,
            "qualification_summary": self.qualification_summary,
            "linkedin_url": self.linkedin_url or self.seed.linkedin_url,
            "reasons": self.reasons,
            "exclusion_reasons": self.exclusion_reasons,
            "geographic_evidence": self.geographic_evidence,
            "pages": [asdict(page) for page in self.pages],
            "contacts": [contact.row() for contact in self.contacts],
            "error": self.error,
            "filter_rejections": self.filter_rejections,
        }
