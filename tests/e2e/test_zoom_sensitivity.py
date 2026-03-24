import sys
import time
import os
import re
from playwright.sync_api import sync_playwright, expect

def test_gestures():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        
        # Listen for console messages
        page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))
        
        base_url = os.environ.get("TEST_URL", "http://localhost:3000")
        target_url = f"{base_url}/tools/image-joiner"
        
        print(f"Navigating to {target_url}")
        page.goto(target_url)
        
        # Upload image
        image_path = os.path.join(os.getcwd(), "tests/e2e/dummy.png")
        input_file = page.locator("input[type='file']").first
        input_file.set_input_files(image_path)
        page.wait_for_selector("img[alt='Viewport Content']", timeout=10000)

        wrapper = page.locator(".react-transform-component").first
        content_div = page.locator("img[alt='Viewport Content']").locator("xpath=..")
        
        def get_state():
            style = content_div.get_attribute("style")
            scale = 1.0
            x, y = 0.0, 0.0
            if style:
                s_match = re.search(r"scale\(([\d\.]+)\)", style)
                if s_match: scale = float(s_match.group(1))
                t_match = re.search(r"translate\(([-\d\.]+)px, ([-\d\.]+)px\)", style)
                if t_match:
                    x = float(t_match.group(1))
                    y = float(t_match.group(2))
            return {"scale": scale, "x": x, "y": y}

        initial = get_state()
        print(f"Initial State: {initial}")
        
        print("Simulating 1 wheel scroll (deltaY=-100)")
        wrapper.dispatch_event("wheel", {
            "deltaY": -100,
            "clientX": 200,
            "clientY": 200,
            "bubbles": True
        })
        time.sleep(0.5)
        print(f"After Wheel: {get_state()}")
        
        browser.close()

if __name__ == "__main__":
    test_gestures()
