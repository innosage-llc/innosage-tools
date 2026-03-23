from playwright.sync_api import Page, expect, sync_playwright

def test_meeting_fixer_page(page: Page):
    page.goto("http://localhost:3000/tools/meeting-fixer")

    # Wait for the page to load
    expect(page.get_by_text("Meeting Fixer").first).to_be_visible()

    # Take screenshot of the setup state
    page.screenshot(path="verification_meeting_fixer_setup.png")

    # Start Recording
    start_btn = page.get_by_role("button", name="Start Recording")

    # Click start recording button to verify it responds
    start_btn.click()
    page.wait_for_timeout(2000) # record for 2s

    # Take screenshot
    page.screenshot(path="verification_meeting_fixer_recording.png")

    # Stop Recording
    stop_btn = page.get_by_role("button", name="Stop Recording")
    stop_btn.click()
    
    # Wait for the status to change to ready
    expect(page.get_by_text("Amendment recorded ready.")).to_be_visible()

    # Take screenshot
    page.screenshot(path="verification_meeting_fixer_recorded.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Launch browser with fake media devices to prevent permissions issues
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
            ]
        )
        # Give permission to camera and microphone
        context = browser.new_context(permissions=['camera', 'microphone'])
        page = context.new_page()
        try:
            test_meeting_fixer_page(page)
        finally:
            browser.close()
