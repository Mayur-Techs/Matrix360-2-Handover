import asyncio
import re
from typing import Callable, List, Dict, Set
from playwright.async_api import async_playwright, Route, Page

STATE_HUBS = {
    "west bengal": [
        "Kolkata", "Howrah", "Dankuni", "Durgapur", "Asansol",
        "Haldia", "Siliguri", "Kharagpur", "Hooghly", "Barrackpore",
        "Budge Budge", "Uluberia", "Kalyani"
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
    "", "Industrial Area", "Industrial Estate", "MIDC", "SIDCO",
    "North", "South", "East", "West", "Central", "Phase 1", "Phase 2"
]

CATEGORY_SYNONYM_MAP = {
    "it": [
        "software company", "information technology", "it service", "web designer",
        "website designer", "computer support", "bpo", "call center", "computer repair",
        "internet cafe", "cyber cafe"
    ],
    "consulting": [
        "consultant", "business management consultant", "management consulting",
        "chartered accountant", "tax consultant", "legal services", "law firm"
    ],
    "marketing": [
        "marketing agency", "advertising agency", "internet marketing service",
        "digital marketing", "public relations", "media company", "graphic designer"
    ],
    "recruitment": [
        "employment agency", "recruiter", "temp agency", "human resource",
        "placement agency", "staffing agency", "security guard service"
    ],
    "bfsi": [
        "bank", "atm", "insurance agency", "financial planner", "loan agency",
        "investment service", "stock broker", "credit union", "finance"
    ],
    "education": [
        "school", "college", "university", "educational institution",
        "coaching center", "training centre", "tutoring service", "preschool", "library"
    ]
}

BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}
BLOCKED_URL_PATTERNS = (
    "khms0.googleapis.com", "khms1.googleapis.com", "streetviewpixels",
    "ggpht.com", "googleusercontent.com", "doubleclick.net", "google-analytics.com",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".woff", ".woff2", ".mp4"
)


async def block_heavy_assets(route: Route):
    req = route.request
    if req.resource_type in BLOCKED_RESOURCE_TYPES:
        await route.abort()
        return
    low_url = req.url.lower()
    if any(pat in low_url for pat in BLOCKED_URL_PATTERNS):
        await route.abort()
        return
    await route.continue_()


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
    keywords = [k.strip() for k in keywords_str.split(",") if k.strip()] or [keywords_str.strip()]
    locations = expand_locations(locations_str)

    queue = []
    seen = set()

    for loc in locations:
        for kw in keywords:
            q_str = f"{kw} in {loc}".strip()
            if q_str.lower() not in seen:
                seen.add(q_str.lower())
                queue.append({"query": q_str, "niche": kw, "location": loc})

    for zone in ZONE_MODIFIERS[1:]:
        for loc in locations:
            for kw in keywords:
                q_str = f"{kw} in {zone} {loc}".replace("  ", " ").strip()
                if q_str.lower() not in seen:
                    seen.add(q_str.lower())
                    queue.append({"query": q_str, "niche": kw, "location": loc})
                if len(queue) >= 450:
                    return queue

    return queue


def is_excluded_business(name: str, category_text: str, exclusions: List[str]) -> bool:
    combined = f"{name} {category_text}".lower()
    if any(bad in combined for bad in ("plant nursery", "garden center", "garden centre", "florist", "botanical garden", "nursery school")):
        return True
    for ex in exclusions:
        ex_clean = ex.strip().lower()
        if not ex_clean or ex_clean == "junior roles":
            continue
        if re.search(rf"\b{re.escape(ex_clean)}\b", combined):
            return True
        if ex_clean in CATEGORY_SYNONYM_MAP:
            for syn in CATEGORY_SYNONYM_MAP[ex_clean]:
                if syn in combined:
                    return True
    return False


async def extract_single_place(
    worker_page: Page,
    place_url: str,
    item: Dict[str, str],
    exclusions: List[str],
    seen_names: Set[str],
    suppressed_set: Set[str]
) -> Dict | None:
    try:
        await worker_page.goto(place_url, timeout=12000, wait_until="domcontentloaded")
        await worker_page.wait_for_selector("h1", timeout=3500)

        name = (await worker_page.locator("h1").first.inner_text()).strip()
        if not name:
            return None

        name_key = name.lower()
        if name_key in seen_names or name_key in suppressed_set:
            return None
        seen_names.add(name_key)

        cat_text = ""
        cat_loc = worker_page.locator('button[jsaction*="pane.rating.category"]')
        if await cat_loc.count() > 0:
            cat_text = (await cat_loc.first.inner_text()).strip()

        if is_excluded_business(name, cat_text, exclusions):
            return None

        website = ""
        web_loc = worker_page.locator('a[data-item-id="authority"]')
        if await web_loc.count() > 0:
            website = (await web_loc.first.get_attribute("href") or "").strip()

        phone = ""
        phone_loc = worker_page.locator('button[data-item-id*="phone:tel:"]')
        if await phone_loc.count() > 0:
            raw_phone = await phone_loc.first.get_attribute("data-item-id") or ""
            phone = raw_phone.replace("phone:tel:", "").strip()

        address = ""
        addr_loc = worker_page.locator('button[data-item-id="address"]')
        if await addr_loc.count() > 0:
            address = (await addr_loc.first.inner_text()).strip()

        rating = ""
        reviews = ""
        rating_loc = worker_page.locator('div[role="main"] span[role="img"]')
        if await rating_loc.count() > 0:
            aria = await rating_loc.first.get_attribute("aria-label") or ""
            r_match = re.search(r"([\d.]+)\s*stars?", aria, re.I)
            if r_match:
                rating = r_match.group(1)
            v_match = re.search(r"([\d,]+)\s*Reviews?", aria, re.I)
            if v_match:
                reviews = v_match.group(1)

        return {
            "business_name": name,
            "niche": item["niche"],
            "location": item["location"],
            "phone": phone,
            "website": website,
            "rating": rating,
            "reviews": reviews,
            "address": address,
            "maps_url": place_url.split("?")[0]
        }
    except Exception:
        return None


async def stream_maps_candidates(
    keywords_str: str,
    locations_str: str,
    exclusions: List[str],
    suppressed_set: Set[str],
    on_candidate_found: Callable[[Dict], asyncio.Future],
    log_callback: Callable[[str], asyncio.Future],
    should_stop: Callable[[], bool]
):
    """
    Real-Time Streaming Producer-Consumer Engine:
    - 1 Feed Tab scrolls and immediately pushes new place URLs into an asyncio.Queue on every scroll tick.
    - 6 Parallel Asset-Blocked Worker Tabs continuously pop URLs from the queue and stream candidates immediately.
    """
    search_queue = build_search_queue(keywords_str, locations_str)
    seen_place_urls: Set[str] = set()
    seen_names: Set[str] = set()
    place_queue: asyncio.Queue = asyncio.Queue(maxsize=120)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1366, "height": 900},
            locale="en-US",
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        )

        feed_page = await context.new_page()
        await feed_page.route("**/*", block_heavy_assets)

        worker_pages = []
        for _ in range(6):
            wp = await context.new_page()
            await wp.route("**/*", block_heavy_assets)
            worker_pages.append(wp)

        producer_done = False

        async def place_consumer(worker_page: Page):
            while not should_stop():
                try:
                    place_url, item = await asyncio.wait_for(place_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    if producer_done and place_queue.empty():
                        break
                    continue

                try:
                    if not should_stop():
                        cand = await extract_single_place(
                            worker_page=worker_page,
                            place_url=place_url,
                            item=item,
                            exclusions=exclusions,
                            seen_names=seen_names,
                            suppressed_set=suppressed_set
                        )
                        if cand and not should_stop():
                            await on_candidate_found(cand)
                finally:
                    place_queue.task_done()

        consumer_tasks = [asyncio.create_task(place_consumer(wp)) for wp in worker_pages]

        for q_idx, item in enumerate(search_queue, 1):
            if should_stop():
                break

            current_query = item["query"]
            await log_callback(f"⚡ [Query {q_idx}/{len(search_queue)}] Live 6-Tab Stream: '{current_query}'...")

            search_url = f"https://www.google.com/maps/search/{current_query.replace(' ', '+')}?hl=en"
            try:
                await feed_page.goto(search_url, timeout=25000, wait_until="domcontentloaded")
            except Exception:
                continue

            feed_selector = 'div[role="feed"]'
            try:
                await feed_page.wait_for_selector(feed_selector, timeout=7000)
            except Exception:
                continue

            stagnant = 0
            discovered_in_query = 0

            for _ in range(25):
                if should_stop():
                    break

                cards = await feed_page.locator('div[role="feed"] a[href*="/maps/place/"]').all()
                new_in_tick = 0
                for card in cards:
                    if should_stop():
                        break
                    href = await card.get_attribute("href")
                    if href:
                        clean_href = href.split("?")[0]
                        if clean_href not in seen_place_urls and clean_href.lower() not in suppressed_set:
                            seen_place_urls.add(clean_href)
                            new_in_tick += 1
                            discovered_in_query += 1
                            await place_queue.put((href, item))

                if new_in_tick == 0:
                    stagnant += 1
                    if stagnant >= 3:
                        break
                else:
                    stagnant = 0

                await feed_page.evaluate(f'document.querySelector(\'{feed_selector}\').scrollBy(0, 2800)')
                await asyncio.sleep(0.45)

        producer_done = True
        await asyncio.gather(*consumer_tasks, return_exceptions=True)
        await browser.close()
