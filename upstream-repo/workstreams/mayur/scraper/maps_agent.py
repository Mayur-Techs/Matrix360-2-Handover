import asyncio
import re
from typing import Callable, List, Dict, Set
from playwright.async_api import async_playwright

# Automatic State-to-Industrial-Hub expansion for West Bengal & East India
STATE_HUBS = {
    "west bengal": [
        "Kolkata", "Howrah", "Dankuni", "Durgapur", "Asansol",
        "Haldia", "Siliguri", "Kharagpur", "Hooghly", "Barrackpore",
        "Budge Budge", "Uluberia", "Kalyani", "Domjur", "Rishra",
        "Serampore", "Tribeni", "Falta", "Raniganj", "Barasat"
    ],
    "odisha": [
        "Bhubaneswar", "Cuttack", "Rourkela", "Paradeep", "Jharsuguda",
        "Sambalpur", "Angul", "Balasore", "Jajpur", "Berhampur", "Khordha"
    ],
    "jharkhand": [
        "Jamshedpur", "Ranchi", "Dhanbad", "Bokaro", "Adityapur",
        "Hazaribagh", "Ramgarh", "Deoghar", "Giridih"
    ],
    "bihar": [
        "Patna", "Hajipur", "Bihta", "Begusarai", "Muzaffarpur",
        "Bhagalpur", "Gaya", "Purnia", "Darbhanga"
    ],
    "assam": [
        "Guwahati", "Tinsukia", "Dibrugarh", "Silchar", "Jorhat",
        "Bongaigaon", "Tezpur", "Nagaon", "Amingaon"
    ]
}

ZONE_MODIFIERS = [
    "", "Industrial Area", "Industrial Estate", "Industrial Park", "SIDCO",
    "Logistics Park", "Warehousing Complex", "North", "South", "East", "West", "Central", "Phase 1", "Phase 2"
]


def expand_locations(raw_location: str) -> List[str]:
    parts = [p.strip() for p in raw_location.split(",") if p.strip()]
    expanded = []
    seen = set()
    for p in parts:
        low = p.lower()
        if low in STATE_HUBS:
            for hub in STATE_HUBS[low]:
                label = f"{hub}, {p}"
                if label.lower() not in seen:
                    seen.add(label.lower())
                    expanded.append(label)
        else:
            if low not in seen:
                seen.add(low)
                expanded.append(p)
    return expanded or [raw_location]


def build_search_queue(keywords_str: str, locations_str: str) -> List[Dict[str, str]]:
    """
    Combines multiple keywords (e.g., Manufacturing, warehouse, logistics, 3PL, engineering)
    with expanded regional industrial hubs to provide thousands of candidate listings (500+ scale).
    """
    keywords = [k.strip() for k in keywords_str.split(",") if k.strip()] or [keywords_str.strip()]
    locations = expand_locations(locations_str)

    queue = []
    seen = set()

    # Pass 1: Base keyword + city combinations
    for loc in locations:
        for kw in keywords:
            q_str = f"{kw} in {loc}".strip()
            if q_str.lower() not in seen:
                seen.add(q_str.lower())
                queue.append({"query": q_str, "niche": kw, "location": loc})

    # Pass 2: Zone-modified queries for deep multi-hundred lead scaling
    for zone in ZONE_MODIFIERS[1:]:
        for loc in locations:
            for kw in keywords:
                q_str = f"{kw} in {zone} {loc}".replace("  ", " ").strip()
                if q_str.lower() not in seen:
                    seen.add(q_str.lower())
                    queue.append({"query": q_str, "niche": kw, "location": loc})
                if len(queue) >= 500:
                    return queue

    return queue


def is_excluded_business(name: str, category_text: str, exclusions: List[str]) -> bool:
    combined = f"{name} {category_text}".lower()
    for ex in exclusions:
        ex_clean = ex.strip().lower()
        if not ex_clean or ex_clean == "junior roles":
            continue
        if re.search(rf"\b{re.escape(ex_clean)}\b", combined):
            return True
    return False


async def stream_maps_candidates(
    keywords_str: str,
    locations_str: str,
    exclusions: List[str],
    suppressed_set: Set[str],
    on_candidate_found: Callable[[Dict], asyncio.Future],
    log_callback: Callable[[str], asyncio.Future],
    should_stop: Callable[[], bool],
    headless: bool = True
):
    """
    Continuously discovers businesses on Google Maps across all industrial keywords & locations
    and streams them to the verification/enrichment workers until the verified lead quota is met.
    """
    search_queue = build_search_queue(keywords_str, locations_str)
    seen_place_urls: Set[str] = set()
    seen_names: Set[str] = set()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=headless,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security"
            ]
        )
        context = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            locale="en-IN",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
        )
        # Stealth init script
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-IN', 'en']});
        """)

        page = await context.new_page()

        for q_idx, item in enumerate(search_queue, 1):
            if should_stop():
                break

            current_query = item["query"]
            await log_callback(f"🔎 [Query {q_idx}/{len(search_queue)}] Maps Discovery Agent: '{current_query}'...")

            search_url = f"https://www.google.com/maps/search/{current_query.replace(' ', '+')}?hl=en"
            try:
                await page.goto(search_url, timeout=35000, wait_until="domcontentloaded")
            except Exception:
                continue

            feed_selector = 'div[role="feed"]'
            try:
                await page.wait_for_selector(feed_selector, timeout=8000)
            except Exception:
                # May have redirected directly to single place or list without role=feed
                pass

            batch_urls: List[str] = []
            stagnant = 0
            prev_len = 0

            # Scroll and collect listing links
            for _ in range(25):
                if should_stop():
                    break
                cards = await page.locator('div[role="feed"] a[href*="/maps/place/"], a[href*="/maps/place/"]').all()
                for card in cards:
                    try:
                        href = await card.get_attribute("href")
                        if href:
                            clean_href = href.split("?")[0]
                            if clean_href not in seen_place_urls and clean_href.lower() not in suppressed_set:
                                seen_place_urls.add(clean_href)
                                batch_urls.append(href)
                    except Exception:
                        continue

                if len(batch_urls) == prev_len:
                    stagnant += 1
                    if stagnant >= 3:
                        break
                else:
                    stagnant = 0
                    prev_len = len(batch_urls)

                try:
                    await page.evaluate(f'if(document.querySelector(\'{feed_selector}\')) document.querySelector(\'{feed_selector}\').scrollBy(0, 2400);')
                except Exception:
                    pass
                await asyncio.sleep(0.8)

            # Visit each collected candidate place
            for place_url in batch_urls:
                if should_stop():
                    break

                try:
                    await page.goto(place_url, timeout=20000, wait_until="domcontentloaded")
                    await page.wait_for_selector("h1", timeout=5000)

                    name = (await page.locator("h1").first.inner_text()).strip()
                    if not name:
                        continue

                    name_key = name.lower()
                    if name_key in seen_names or name_key in suppressed_set:
                        continue
                    seen_names.add(name_key)

                    # Extract category text to check industry exclusions early
                    cat_text = ""
                    cat_loc = page.locator('button[jsaction*="pane.rating.category"]')
                    if await cat_loc.count() > 0:
                        cat_text = (await cat_loc.first.inner_text()).strip()

                    if is_excluded_business(name, cat_text, exclusions):
                        continue

                    website = ""
                    web_loc = page.locator('a[data-item-id="authority"]')
                    if await web_loc.count() > 0:
                        website = (await web_loc.first.get_attribute("href") or "").strip()

                    phone = ""
                    phone_loc = page.locator('button[data-item-id*="phone:tel:"]')
                    if await phone_loc.count() > 0:
                        raw_phone = await phone_loc.first.get_attribute("data-item-id") or ""
                        phone = raw_phone.replace("phone:tel:", "").strip()

                    address = ""
                    addr_loc = page.locator('button[data-item-id="address"]')
                    if await addr_loc.count() > 0:
                        address = (await addr_loc.first.inner_text()).strip()

                    rating = ""
                    reviews = ""
                    rating_loc = page.locator('div[role="main"] span[role="img"]')
                    if await rating_loc.count() > 0:
                        aria = await rating_loc.first.get_attribute("aria-label") or ""
                        r_match = re.search(r"([\d.]+)\s*stars?", aria, re.I)
                        if r_match:
                            rating = r_match.group(1)
                        v_match = re.search(r"([\d,]+)\s*Reviews?", aria, re.I)
                        if v_match:
                            reviews = v_match.group(1)

                    candidate = {
                        "business_name": name,
                        "niche": cat_text or item["niche"],
                        "location": item["location"],
                        "phone": phone,
                        "website": website,
                        "rating": rating,
                        "reviews": reviews,
                        "address": address,
                        "maps_url": place_url.split("?")[0]
                    }
                    await on_candidate_found(candidate)
                except Exception:
                    continue

        await browser.close()
