import subprocess
import re

out = subprocess.check_output([
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '--headless=new',
    '--dump-dom',
    'http://127.0.0.1:8020/client-dashboard.html?page=marketing#marketing'
], encoding='utf-8')

print("DOM Length:", len(out))

# 1. Check navigation
nav_pills = re.findall(r'<button[^>]*data-m360-goto=["\']([^"\']+)["\'][^>]*>', out)
print("Nav pills found:", nav_pills)

# 2. Check marketing-centre visibility
mkt_match = re.search(r'<section[^>]+id=["\']marketing-centre["\'][^>]*>', out)
if mkt_match:
    print("Marketing Centre Tag:\n ", mkt_match.group(0))

# 3. Check Channel tabs
ch_tabs = re.findall(r'<button[^>]*class=["\'][^"\']*m360-tab-pill[^"\']*["\'][^>]*data-channel=["\']([^"\']+)["\']', out)
print("10 Channel Tabs found:", ch_tabs)
print("Count of channel tabs:", len(ch_tabs))

# 4. Check Stepper
stepper = re.findall(r'id=["\']step-([^"\']+)["\']', out)
print("Stepper Steps found:", stepper)

# 5. Check Agents
agents = re.findall(r'id=["\']box-agent-([^"\']+)["\']', out)
print("Agent Boxes found:", agents)

# 6. Check CTWA and Budget badges
print("Contains CTWA card:", 'm360-ctwa-card' in out)
print("Contains ESTIMATE_ONLY badge:", 'ESTIMATE_ONLY_NOT_HISTORICAL_RESULT' in out)

# 7. Check WhatsApp & Email views
print("Contains wa-bubble:", 'm360-wa-bubble' in out)
print("Contains email-mockup:", 'm360-email-mockup' in out or 'm360-channel-custom-view' in out)

# 8. Check 3-Gate checklist
gates = re.findall(r'<h4>(Gate \d:[^<]+)</h4>', out)
print("Gates found:", gates)
