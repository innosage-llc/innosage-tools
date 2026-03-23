from playwright.sync_api import sync_playwright

def verify_meeting_fixer(page):
    # Navigate to the tools page
    # Important: The app runs with basePath: '/tools' per memory instructions
    # Check next.config.ts if this is still true, but memory said it
    page.goto("http://localhost:3000/tools")

    # Check if the Meeting Fixer link exists on the main page
    page.screenshot(path="verification_setup.png")

    # Click on the Meeting Fixer card
    page.get_by_role("link", name="Meeting Fixer").click()

    # Wait for the Meeting Fixer page to load (checking for Step 1 title)
    page.wait_for_selector("text=Step 1: Upload Original Recording")

    # Take a screenshot
    page.screenshot(path="verification.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    try:
        verify_meeting_fixer(page)
        print("Success")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()
