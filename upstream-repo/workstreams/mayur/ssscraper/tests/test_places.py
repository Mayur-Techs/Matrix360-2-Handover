import json

from app.places import GooglePlacesDiscovery


def test_authorized_places_discovery_keeps_only_official_websites() -> None:
    requests = []

    def fetch(request):
        requests.append(request)
        return {
            "places": [
                {"id": "place-1", "displayName": {"text": "Alpha Consulting"}, "websiteUri": "https://www.alpha.example/", "formattedAddress": "Pune"},
                {"id": "place-2", "displayName": {"text": "No Website"}, "formattedAddress": "Pune"},
            ]
        }

    events = []
    seeds, summary = GooglePlacesDiscovery("test-key", fetch).discover(["consultants in Pune"], 10, lambda name, data: events.append((name, data)))

    assert len(seeds) == 1
    assert seeds[0].domain == "alpha.example"
    assert seeds[0].source_id == "google-place:place-1"
    assert summary.official_website_candidates == 1
    assert summary.skipped_without_official_website == 1
    assert requests[0].full_url == "https://places.googleapis.com/v1/places:searchText"
    assert json.loads(requests[0].data.decode("utf-8"))["textQuery"] == "consultants in Pune"
    assert any(name == "agent_finished" for name, _ in events)
