import sys
import time
from playwright.sync_api import sync_playwright, expect

def test_image_joiner(page):
    # Go to local server
    # The Next.js application is configured with basePath: '/tools' per system memory.
    page.goto("http://localhost:3000/tools/image-joiner")

    # Wait for the title
    expect(page.get_by_role("heading", name="Image Joiner")).to_be_visible(timeout=10000)

    # We should have two "Click or Drop Image" texts
    upload_labels = page.get_by_text("Click or Drop Image")
    expect(upload_labels).to_have_count(2)

    # Take a screenshot of the initial state
    page.screenshot(path="verification_image_joiner_initial.png")

    # We can create dummy images to upload to test the WYSIWYG
    # For now, just verifying the page renders correctly with the viewports.

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_image_joiner(page)
            print("Successfully verified the UI.")
        except Exception as e:
            print(f"Failed verification: {e}")
            sys.exit(1)
        finally:
            browser.close()
