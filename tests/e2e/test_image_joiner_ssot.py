import os
import time
import re
from contextlib import contextmanager
import pytest
from playwright.sync_api import sync_playwright, expect

# Global step counter for ordering screenshots
_step_counter = 0

def slugify(text):
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')

@contextmanager
def step(title: str, page):
    """
    Context manager to wrap test steps with a human-readable title.
    Captures the title and a screenshot after the step completes.
    """
    global _step_counter
    _step_counter += 1
    current_step = _step_counter
    
    print(f"\n--- STEP: {title} ---")
    yield
    
    # Ensure screenshot directory exists
    screenshot_dir = "test-results/screenshots"
    os.makedirs(screenshot_dir, exist_ok=True)
    
    # Take screenshot after the step logic is executed
    safe_title = slugify(title)
    screenshot_path = f"{screenshot_dir}/step_{current_step}_{safe_title}.png"
    page.screenshot(path=screenshot_path)
    print(f"--- SCREENSHOT: {screenshot_path} ---")

def test_image_joiner_core_journey(page):
    """
    Feature: Image Joiner - Core Functionality
    The Image Joiner allows users to combine multiple images into a single image.
    """
    # Capture console logs
    page.on("console", lambda msg: print(f"BROWSER: {msg.text}"))

    base_url = os.environ.get("TEST_URL", "http://localhost:3000")
    target_url = f"{base_url}/tools/image-joiner"

    with step("User navigates to the Image Joiner tool", page):
        page.goto(target_url)
        page.wait_for_load_state("networkidle")
        expect(page.locator("h1")).to_contain_text("Image Joiner")

    with step("User uploads the first image", page):
        image_path = os.path.join(os.getcwd(), "tests/e2e/dummy.png")
        input_file = page.locator("input[type='file']").first
        input_file.set_input_files(image_path)
        page.wait_for_selector("img[alt='Viewport Content']", timeout=10000)
        time.sleep(3)

    with step("User uploads the second image", page):
        image_path = os.path.join(os.getcwd(), "tests/e2e/dummy2.png")
        input_file = page.locator("input[type='file']").first
        input_file.set_input_files(image_path)
        expect(page.locator("img[alt='Viewport Content']")).to_have_count(2)
        time.sleep(3)

    with step("User zooms into the first image", page):
        wrapper = page.locator(".react-transform-component").first
        wrapper.dispatch_event("wheel", {
            "deltaY": -200,
            "clientX": 100,
            "clientY": 100,
            "bubbles": True
        })
        time.sleep(2)

    with step("User completes the journey", page):
        print("Journey completed. Generating storyboard...")
        time.sleep(1)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        test_image_joiner_core_journey(page)
        browser.close()
